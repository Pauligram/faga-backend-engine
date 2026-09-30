<?php
declare(strict_types=1);

namespace App\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

final class FinancialLedgerService
{
    private const CURRENCY = 'NGN';

    /**
     * Post a balanced double-entry transaction.
     *
     * Account IDs must reference existing, active ledger accounts.
     * Amounts are positive integers expressed in minor currency units.
     *
     * @param array<int, array{
     *     account_id: string,
     *     direction: string,
     *     amount_minor: int
     * }> $entries
     * @param array<string, mixed> $metadata
     */
    public function post(
        string $idempotencyKey,
        string $reference,
        string $type,
        string $currency,
        array $entries,
        array $metadata = []
    ): string {
        $this->validateIdentity(
            $idempotencyKey,
            $reference,
            $type,
            $currency
        );

        $normalized = $this->normalizeEntries($entries);

        $fingerprint = hash(
            'sha256',
            json_encode(
                [
                    'reference' => $reference,
                    'type' => $type,
                    'currency' => $currency,
                    'entries' => $normalized,
                ],
                JSON_THROW_ON_ERROR
            )
        );

        try {
            return DB::transaction(
                function () use (
                    $idempotencyKey,
                    $reference,
                    $type,
                    $currency,
                    $normalized,
                    $metadata,
                    $fingerprint
                ): string {
                    return $this->postWithinTransaction(
                        $idempotencyKey,
                        $reference,
                        $type,
                        $currency,
                        $normalized,
                        $metadata,
                        $fingerprint
                    );
                },
                3
            );
        } catch (Throwable $exception) {
            throw $exception;
        }
    }

    /**
     * Settle a previously verified provider payment.
     *
     * The payment intent is locked before its ledger transaction
     * is created. A repeated call returns the original transaction.
     */
    public function settleVerifiedPayment(
        string $providerReference,
        string $provider,
        int $verifiedAmountMinor,
        string $verifiedCurrency,
        string $providerTransactionId
    ): string {
        if (
            $providerReference === '' ||
            $provider !== 'paystack' ||
            $verifiedAmountMinor <= 0 ||
            $verifiedCurrency !== self::CURRENCY ||
            $providerTransactionId === ''
        ) {
            throw new InvalidArgumentException(
                'Invalid verified payment details.'
            );
        }

        try {
            return DB::transaction(
                function () use (
                    $providerReference,
                    $provider,
                    $verifiedAmountMinor,
                    $verifiedCurrency,
                    $providerTransactionId
                ): string {
                    $intent = DB::table('payment_intents')
                        ->where('provider', $provider)
                        ->where(
                            'provider_reference',
                            $providerReference
                        )
                        ->lockForUpdate()
                        ->first();

                    if ($intent === null) {
                        throw new RuntimeException(
                            'Payment intent not found.'
                        );
                    }

                    if (
                        (int) $intent->amount_minor
                            !== $verifiedAmountMinor ||
                        $intent->currency !== $verifiedCurrency
                    ) {
                        throw new RuntimeException(
                            'Verified payment does not match the intent.'
                        );
                    }

                    if ($intent->status === 'settled') {
                        if ($intent->ledger_transaction_id === null) {
                            throw new RuntimeException(
                                'Settled payment has no ledger transaction.'
                            );
                        }

                        return (string) $intent->ledger_transaction_id;
                    }

                    if ($intent->status !== 'pending') {
                        throw new RuntimeException(
                            'Payment intent is not eligible for settlement.'
                        );
                    }

                    $commissionBps = (int) $intent->commission_bps;

                    if (
                        $commissionBps < 0 ||
                        $commissionBps > 10000
                    ) {
                        throw new RuntimeException(
                            'Invalid stored commission rate.'
                        );
                    }

                    $commission = intdiv(
                        $verifiedAmountMinor * $commissionBps,
                        10000
                    );

                    $beneficiaryAmount =
                        $verifiedAmountMinor - $commission;

                    $cashAccount = $this->ensureAccount(
                        'PLATFORM:PAYSTACK:CASH:NGN',
                        'Paystack clearing asset',
                        'asset'
                    );

                    $entries = [
                        [
                            'account_id' => $cashAccount,
                            'direction' => 'debit',
                            'amount_minor' => $verifiedAmountMinor,
                        ],
                    ];

                    if ($commission > 0) {
                        $revenueAccount = $this->ensureAccount(
                            'PLATFORM:COMMISSION:NGN',
                            'Platform commission revenue',
                            'revenue'
                        );

                        $entries[] = [
                            'account_id' => $revenueAccount,
                            'direction' => 'credit',
                            'amount_minor' => $commission,
                        ];
                    }

                    if ($beneficiaryAmount > 0) {
                        $beneficiaryId =
                            (int) $intent->beneficiary_id;

                        $payableAccount = $this->ensureAccount(
                            'USER:' . $beneficiaryId . ':PAYABLE:NGN',
                            'User available balance',
                            'liability',
                            $beneficiaryId
                        );

                        $entries[] = [
                            'account_id' => $payableAccount,
                            'direction' => 'credit',
                            'amount_minor' => $beneficiaryAmount,
                        ];
                    }

                    $transactionId = $this->post(
                        'payment:' . $provider . ':' .
                            $providerReference,
                        'PAYMENT:' . $providerReference,
                        'payment_settlement',
                        $verifiedCurrency,
                        $entries,
                        [
                            'payment_intent_id' => $intent->id,
                            'provider' => $provider,
                            'provider_transaction_id' =>
                                $providerTransactionId,
                            'customer_id' => $intent->customer_id,
                            'beneficiary_id' =>
                                $intent->beneficiary_id,
                            'resource_type' =>
                                $intent->resource_type,
                            'resource_id' => $intent->resource_id,
                            'commission_minor' => $commission,
                            'beneficiary_amount_minor' =>
                                $beneficiaryAmount,
                        ]
                    );

                    $updated = DB::table('payment_intents')
                        ->where('id', $intent->id)
                        ->where('status', 'pending')
                        ->update([
                            'status' => 'settled',
                            'ledger_transaction_id' =>
                                $transactionId,
                            'verified_at' => now(),
                            'updated_at' => now(),
                        ]);

                    if ($updated !== 1) {
                        throw new RuntimeException(
                            'Payment settlement state conflict.'
                        );
                    }

                    return $transactionId;
                },
                3
            );
        } catch (Throwable $exception) {
            throw $exception;
        }
    }

    public function balance(string $accountId): int
    {
        if (! Str::isUuid($accountId)) {
            throw new InvalidArgumentException(
                'Invalid ledger account identifier.'
            );
        }

        $account = DB::table('ledger_accounts')
            ->where('id', $accountId)
            ->where('is_active', true)
            ->first();

        if ($account === null) {
            throw new RuntimeException(
                'Active ledger account not found.'
            );
        }

        return (int) $account->balance_minor;
    }

    private function ensureAccount(
        string $code,
        string $name,
        string $type,
        ?int $userId = null
    ): string {
        if (
            $code === '' ||
            $name === '' ||
            ! in_array(
                $type,
                ['asset', 'liability', 'revenue', 'expense', 'equity'],
                true
            )
        ) {
            throw new InvalidArgumentException(
                'Invalid ledger account configuration.'
            );
        }

        DB::table('ledger_accounts')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'code' => $code,
            'name' => $name,
            'type' => $type,
            'currency' => self::CURRENCY,
            'balance_minor' => 0,
            'allow_negative' => false,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $account = DB::table('ledger_accounts')
            ->where('code', $code)
            ->lockForUpdate()
            ->first();

        if (
            $account === null ||
            $account->type !== $type ||
            $account->currency !== self::CURRENCY ||
            ($account->user_id === null
                ? null
                : (int) $account->user_id) !== $userId ||
            ! (bool) $account->is_active ||
            (bool) $account->allow_negative
        ) {
            throw new RuntimeException(
                'Ledger account configuration conflict.'
            );
        }

        return (string) $account->id;
    }

    /**
     * @param array<int, array{
     *     account_id: string,
     *     direction: string,
     *     amount_minor: int
     * }> $entries
     *
     * @return array<int, array{
     *     account_id: string,
     *     direction: string,
     *     amount_minor: int
     * }>
     */
    private function normalizeEntries(array $entries): array
    {
        if (count($entries) < 2) {
            throw new InvalidArgumentException(
                'At least two ledger entries are required.'
            );
        }

        $debits = 0;
        $credits = 0;
        $normalized = [];

        foreach ($entries as $entry) {
            $accountId = $entry['account_id'] ?? null;
            $direction = $entry['direction'] ?? null;
            $amount = $entry['amount_minor'] ?? null;

            if (
                ! is_string($accountId) ||
                ! Str::isUuid($accountId) ||
                ! in_array(
                    $direction,
                    ['debit', 'credit'],
                    true
                ) ||
                ! is_int($amount) ||
                $amount <= 0
            ) {
                throw new InvalidArgumentException(
                    'Invalid ledger entry.'
                );
            }

            if ($direction === 'debit') {
                $debits = $this->safeAdd($debits, $amount);
            } else {
                $credits = $this->safeAdd($credits, $amount);
            }

            $normalized[] = [
                'account_id' => $accountId,
                'direction' => $direction,
                'amount_minor' => $amount,
            ];
        }

        if ($debits !== $credits || $debits === 0) {
            throw new InvalidArgumentException(
                'Ledger transaction is not balanced.'
            );
        }

        usort(
            $normalized,
            static fn (array $a, array $b): int =>
                [$a['account_id'], $a['direction'], $a['amount_minor']]
                <=>
                [$b['account_id'], $b['direction'], $b['amount_minor']]
        );

        return $normalized;
    }

    /**
     * Called within a database transaction.
     *
     * @param array<int, array{
     *     account_id: string,
     *     direction: string,
     *     amount_minor: int
     * }> $entries
     * @param array<string, mixed> $metadata
     */
    private function postWithinTransaction(
        string $idempotencyKey,
        string $reference,
        string $type,
        string $currency,
        array $entries,
        array $metadata,
        string $fingerprint
    ): string {
        $transactionId = (string) Str::uuid();

        $inserted = DB::table('ledger_transactions')
            ->insertOrIgnore([
                'id' => $transactionId,
                'idempotency_key' => $idempotencyKey,
                'reference' => $reference,
                'type' => $type,
                'currency' => $currency,
                'amount_minor' => array_sum(
                    array_map(
                        static fn (array $entry): int =>
                            $entry['direction'] === 'debit'
                                ? $entry['amount_minor']
                                : 0,
                        $entries
                    )
                ),
                'status' => 'preparing',
                'metadata' => json_encode(
                    [
                        'fingerprint' => $fingerprint,
                        'context' => $metadata,
                    ],
                    JSON_THROW_ON_ERROR
                ),
                'posted_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

        if ($inserted === 0) {
            $existing = DB::table('ledger_transactions')
                ->where('idempotency_key', $idempotencyKey)
                ->lockForUpdate()
                ->first();

            if ($existing === null) {
                throw new RuntimeException(
                    'Ledger reference or idempotency conflict.'
                );
            }

            $storedMetadata = json_decode(
                (string) $existing->metadata,
                true,
                512,
                JSON_THROW_ON_ERROR
            );

            if (
                $existing->reference !== $reference ||
                $existing->type !== $type ||
                $existing->currency !== $currency ||
                $existing->status !== 'posted' ||
                ($storedMetadata['fingerprint'] ?? null)
                    !== $fingerprint
            ) {
                throw new RuntimeException(
                    'Ledger idempotency conflict.'
                );
            }

            return (string) $existing->id;
        }

        $accountIds = array_values(
            array_unique(
                array_column($entries, 'account_id')
            )
        );

        sort($accountIds, SORT_STRING);

        $accounts = DB::table('ledger_accounts')
            ->whereIn('id', $accountIds)
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        if ($accounts->count() !== count($accountIds)) {
            throw new RuntimeException(
                'One or more ledger accounts do not exist.'
            );
        }

        $deltas = array_fill_keys($accountIds, 0);

        foreach ($entries as $entry) {
            $account = $accounts->get($entry['account_id']);

            if (
                $account === null ||
                ! (bool) $account->is_active ||
                $account->currency !== $currency
            ) {
                throw new RuntimeException(
                    'Inactive or incompatible ledger account.'
                );
            }

            $debitNormal = in_array(
                $account->type,
                ['asset', 'expense'],
                true
            );

            $increases = $debitNormal
                ? $entry['direction'] === 'debit'
                : $entry['direction'] === 'credit';

            $signedAmount = $increases
                ? $entry['amount_minor']
                : -$entry['amount_minor'];

            $deltas[$entry['account_id']] = $this->safeAdd(
                $deltas[$entry['account_id']],
                $signedAmount
            );
        }

        foreach ($accountIds as $accountId) {
            $account = $accounts->get($accountId);

            $newBalance = $this->safeAdd(
                (int) $account->balance_minor,
                $deltas[$accountId]
            );

            if (
                $newBalance < 0 &&
                ! (bool) $account->allow_negative
            ) {
                throw new RuntimeException(
                    'Insufficient ledger balance.'
                );
            }

            DB::table('ledger_accounts')
                ->where('id', $accountId)
                ->update([
                    'balance_minor' => $newBalance,
                    'updated_at' => now(),
                ]);
        }

        foreach ($entries as $entry) {
            DB::table('ledger_entries')->insert([
                'transaction_id' => $transactionId,
                'account_id' => $entry['account_id'],
                'direction' => $entry['direction'],
                'amount_minor' => $entry['amount_minor'],
                'currency' => $currency,
                'created_at' => now(),
            ]);
        }

        DB::table('ledger_transactions')
            ->where('id', $transactionId)
            ->where('status', 'preparing')
            ->update([
                'status' => 'posted',
                'updated_at' => now(),
            ]);

        return $transactionId;
    }

    private function validateIdentity(
        string $idempotencyKey,
        string $reference,
        string $type,
        string $currency
    ): void {
        if (
            $idempotencyKey === '' ||
            strlen($idempotencyKey) > 150 ||
            $reference === '' ||
            strlen($reference) > 150 ||
            $type === '' ||
            strlen($type) > 40 ||
            ! preg_match('/^[A-Z]{3}$/', $currency)
        ) {
            throw new InvalidArgumentException(
                'Invalid ledger transaction identity.'
            );
        }
    }

    private function safeAdd(int $a, int $b): int
    {
        if (
            ($b > 0 && $a > PHP_INT_MAX - $b) ||
            ($b < 0 && $a < PHP_INT_MIN - $b)
        ) {
            throw new RuntimeException(
                'Ledger arithmetic overflow.'
            );
        }

        return $a + $b;
    }
}