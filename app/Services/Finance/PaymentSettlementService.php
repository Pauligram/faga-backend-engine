<?php
declare(strict_types=1);

namespace App\Services\Finance;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

final class PaymentSettlementService
{
    public function __construct(
        private readonly LedgerService $ledger
    ) {}

    /**
     * Create a payment intent before contacting the provider.
     *
     * Commission is captured at creation and cannot be changed
     * by the customer during verification.
     */
    public function initialize(
        int $customerId,
        int $beneficiaryId,
        string $purpose,
        string $resourceType,
        string $resourceId,
        int $amountMinor,
        int $commissionBps,
        string $customerEmail
    ): array {
        if (
            $amountMinor <= 0 ||
            $commissionBps < 0 ||
            $commissionBps > 10000
        ) {
            throw new RuntimeException('Invalid settlement configuration.');
        }

        $secret = config('services.paystack.secret_key');

        if (! is_string($secret) || $secret === '') {
            throw new RuntimeException('Payment provider is not configured.');
        }

        $intentId = (string) Str::uuid();
        $reference = 'FAGA-' . Str::upper(Str::ulid()->toBase32());

        DB::table('payment_intents')->insert([
            'id' => $intentId,
            'customer_id' => $customerId,
            'provider' => 'paystack',
            'provider_reference' => $reference,
            'purpose' => $purpose,
            'resource_type' => $resourceType,
            'resource_id' => $resourceId,
            'currency' => 'NGN',
            'amount_minor' => $amountMinor,
            'commission_bps' => $commissionBps,
            'beneficiary_id' => $beneficiaryId,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            $response = Http::withToken($secret)
                ->acceptJson()
                ->timeout(15)
                ->post('https://api.paystack.co/transaction/initialize', [
                    'email' => $customerEmail,
                    'amount' => $amountMinor,
                    'currency' => 'NGN',
                    'reference' => $reference,
                    'metadata' => [
                        'faga_payment_intent_id' => $intentId,
                    ],
                ])
                ->throw()
                ->json();

            if (
                ($response['status'] ?? false) !== true ||
                ! is_string($response['data']['authorization_url'] ?? null)
            ) {
                throw new RuntimeException('Payment initialization failed.');
            }

            return [
                'payment_intent_id' => $intentId,
                'reference' => $reference,
                'authorization_url' => $response['data']['authorization_url'],
            ];
        } catch (\Throwable $exception) {
            DB::table('payment_intents')
                ->where('id', $intentId)
                ->where('status', 'pending')
                ->update([
                    'status' => 'initialization_failed',
                    'updated_at' => now(),
                ]);

            throw $exception;
        }
    }

    /**
     * Always verify payment directly with the provider.
     * Never trust a browser redirect or webhook body as proof
     * of successful payment.
     */
    public function verifyAndSettle(string $reference): string
    {
        $secret = config('services.paystack.secret_key');

        if (! is_string($secret) || $secret === '') {
            throw new RuntimeException('Payment provider is not configured.');
        }

        $intent = DB::table('payment_intents')
            ->where('provider_reference', $reference)
            ->first();

        if ($intent === null) {
            throw new RuntimeException('Unknown payment reference.');
        }

        if ($intent->status === 'settled') {
            return (string) $intent->ledger_transaction_id;
        }

        if ($intent->status !== 'pending') {
            throw new RuntimeException('Payment is not eligible for settlement.');
        }

        $response = Http::withToken($secret)
            ->acceptJson()
            ->timeout(15)
            ->get(
                'https://api.paystack.co/transaction/verify/' .
                rawurlencode($reference)
            )
            ->throw()
            ->json();

        $payment = $response['data'] ?? [];

        if (
            ($response['status'] ?? false) !== true ||
            ($payment['status'] ?? null) !== 'success' ||
            ($payment['reference'] ?? null) !== $reference ||
            ($payment['currency'] ?? null) !== $intent->currency ||
            (int) ($payment['amount'] ?? -1) !== (int) $intent->amount_minor
        ) {
            throw new RuntimeException('Payment verification failed.');
        }

        return DB::transaction(function () use ($reference): string {
            $intent = DB::table('payment_intents')
                ->where('provider_reference', $reference)
                ->lockForUpdate()
                ->first();

            if ($intent === null) {
                throw new RuntimeException('Payment intent disappeared.');
            }

            if ($intent->status === 'settled') {
                return (string) $intent->ledger_transaction_id;
            }

            if ($intent->status !== 'pending') {
                throw new RuntimeException('Payment cannot be settled.');
            }

            $amount = (int) $intent->amount_minor;
            $commission = intdiv(
                $amount * (int) $intent->commission_bps,
                10000
            );
            $beneficiaryAmount = $amount - $commission;

            $cashAccount = $this->ledger->account(
                'PLATFORM:PAYSTACK:CASH:NGN',
                'Paystack clearing asset',
                'asset'
            );

            $revenueAccount = $this->ledger->account(
                'PLATFORM:COMMISSION:NGN',
                'Platform commission revenue',
                'revenue'
            );

            $beneficiaryAccount = $this->ledger->account(
                'USER:' . $intent->beneficiary_id . ':PAYABLE:NGN',
                'Beneficiary payable',
                'liability',
                (int) $intent->beneficiary_id
            );

            $entries = [
                [
                    'account_id' => $cashAccount,
                    'direction' => 'debit',
                    'amount_minor' => $amount,
                ],
            ];

            if ($commission > 0) {
                $entries[] = [
                    'account_id' => $revenueAccount,
                    'direction' => 'credit',
                    'amount_minor' => $commission,
                ];
            }

            if ($beneficiaryAmount > 0) {
                $entries[] = [
                    'account_id' => $beneficiaryAccount,
                    'direction' => 'credit',
                    'amount_minor' => $beneficiaryAmount,
                ];
            }

            $transactionId = $this->ledger->post(
                'payment:' . $reference,
                'PAYMENT:' . $reference,
                'payment_settlement',
                $intent->currency,
                $entries,
                [
                    'payment_intent_id' => $intent->id,
                    'resource_type' => $intent->resource_type,
                    'resource_id' => $intent->resource_id,
                    'customer_id' => $intent->customer_id,
                    'beneficiary_id' => $intent->beneficiary_id,
                ]
            );

            DB::table('payment_intents')
                ->where('id', $intent->id)
                ->where('status', 'pending')
                ->update([
                    'status' => 'settled',
                    'ledger_transaction_id' => $transactionId,
                    'verified_at' => now(),
                    'updated_at' => now(),
                ]);

            return $transactionId;
        }, 3);
    }
}
