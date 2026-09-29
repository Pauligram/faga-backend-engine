<?php
declare(strict_types=1);

namespace App\Services\Finance;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;
use RuntimeException;

final class LedgerService
{
    /**
     * Debit increases asset and expense accounts.
     * Credit increases liability, revenue and equity accounts.
     */
    private const DEBIT_NORMAL = ['asset', 'expense'];

    private const CREDIT_NORMAL = ['liability', 'revenue', 'equity'];

    public function account(
        string $code,
        string $name,
        string $type,
        ?int $userId = null,
        string $currency = 'NGN',
        bool $allowNegative = false
    ): string {
        if (! in_array($type, [
            'asset', 'liability', 'revenue', 'expense', 'equity',
        ], true)) {
            throw new InvalidArgumentException('Invalid account type.');
        }

        if (! preg_match('/^[A-Z]{3}$/', $currency)) {
            throw new InvalidArgumentException('Invalid currency.');
        }

        return DB::transaction(function () use (
            $code,
            $name,
            $type,
            $userId,
            $currency,
            $allowNegative
        ): string {
            DB::table('ledger_accounts')->insertOrIgnore([
                'id' => (string) Str::uuid(),
                'user_id' => $userId,
                'code' => $code,
                'name' => $name,
                'type' => $type,
                'currency' => $currency,
                'balance_minor' => 0,
                'allow_negative' => $allowNegative,
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
                $account->currency !== $currency ||
                ($account->user_id === null ? null : (int) $account->user_id)
                    !== $userId ||
                (bool) $account->allow_negative !== $allowNegative
            ) {
                throw new RuntimeException('Ledger account configuration conflict.');
            }

            return $account->id;
        }, 3);
    }

    /**
     * Post one balanced, immutable transaction.
     *
     * Each entry:
     * [
     *   'account_id' => UUID,
     *   'direction' => 'debit' or 'credit',
     *   'amount_minor' => positive integer
     * ]
     *
     * The caller must supply a stable idempotency key and reference.
     */
    public function post(
        string $idempotencyKey,
        string $reference,
        string $type,
        string $currency,
        array $entries,
        array $metadata = []
    ): string {
        if (
            $idempotencyKey === '' ||
            $reference === '' ||
            $type === '' ||
            ! preg_match('/^[A-Z]{3}$/', $currency)
        ) {
            throw new InvalidArgumentException('Invalid transaction identity.');
        }

        if (count($entries) < 2) {
            throw new InvalidArgumentException(
                'A transaction requires at least two entries.'
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
                ! in_array($direction, ['debit', 'credit'], true) ||
                ! is_int($amount) ||
                $amount <= 0
            ) {
                throw new InvalidArgumentException('Invalid ledger entry.');
            }

            $normalized[] = [
                'account_id' => $accountId,
                'direction' => $direction,
                'amount_minor' => $amount,
            ];

            if ($direction === 'debit') {
                $debits += $amount;
            } else {
                $credits += $amount;
            }
        }

        if ($debits !== $credits || $debits <= 0) {
            throw new InvalidArgumentException('Ledger entries are not balanced.');
        }

        $fingerprint = hash('sha256', json_encode([
            'reference' => $reference,
            'type' => $type,
            'currency' => $currency,
            'entries' => $normalized,
        ], JSON_THROW_ON_ERROR));

        return DB::transaction(function () use (
            $idempotencyKey,
            $reference,
            $type,
            $currency,
            $normalized,
            $debits,
            $metadata,
            $fingerprint
        ): string {
            $existing = DB::table('ledger_transactions')
                ->where('idempotency_key', $idempotencyKey)
                ->lockForUpdate()
                ->first();

            if ($existing !== null) {
                $stored = json_decode(
                    $existing->metadata ?? '{}',
                    true,
                    512,
                    JSON_THROW_ON_ERROR
                );

                if (($stored['fingerprint'] ?? null) !== $fingerprint) {
                    throw new RuntimeException('Idempotency key conflict.');
                }

                return $existing->id;
            }

            $accountIds = array_values(array_unique(array_column(
                $normalized,
                'account_id'
            )));

            sort($accountIds, SORT_STRING);

            $accounts = DB::table('ledger_accounts')
                ->whereIn('id', $accountIds)
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            if ($accounts->count() !== count($accountIds)) {
                throw new RuntimeException('Ledger account not found.');
            }

            $deltas = array_fill_keys($accountIds, 0);

            foreach ($normalized as $entry) {
                $account = $accounts[$entry['account_id']];

                if (! $account->is_active || $account->currency !== $currency) {
                    throw new RuntimeException('Inactive or incompatible account.');
                }

                $normalDebit = in_array(
                    $account->type,
                    self::DEBIT_NORMAL,
                    true
                );

                $increases = $normalDebit
                    ? $entry['direction'] === 'debit'
                    : $entry['direction'] === 'credit';

                $deltas[$entry['account_id']] += $increases
                    ? $entry['amount_minor']
                    : -$entry['amount_minor'];
            }

            foreach ($accountIds as $accountId) {
                $account = $accounts[$accountId];
                $newBalance = (int) $account->balance_minor + $deltas[$accountId];

                if ($newBalance < 0 && ! $account->allow_negative) {
                    throw new RuntimeException('Insufficient ledger balance.');
                }

                DB::table('ledger_accounts')
                    ->where('id', $accountId)
                    ->update([
                        'balance_minor' => $newBalance,
                        'updated_at' => now(),
                    ]);
            }

            $transactionId = (string) Str::uuid();

            DB::table('ledger_transactions')->insert([
                'id' => $transactionId,
                'idempotency_key' => $idempotencyKey,
                'reference' => $reference,
                'type' => $type,
                'currency' => $currency,
                'amount_minor' => $debits,
                'status' => 'posted',
                'metadata' => json_encode(
                    ['fingerprint' => $fingerprint, 'context' => $metadata],
                    JSON_THROW_ON_ERROR
                ),
                'posted_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            foreach ($normalized as $entry) {
                DB::table('ledger_entries')->insert([
                    'transaction_id' => $transactionId,
                    'account_id' => $entry['account_id'],
                    'direction' => $entry['direction'],
                    'amount_minor' => $entry['amount_minor'],
                    'currency' => $currency,
                    'created_at' => now(),
                ]);
            }

            return $transactionId;
        }, 3);
    }

    public function balance(string $accountId): int
    {
        $balance = DB::table('ledger_accounts')
            ->where('id', $accountId)
            ->where('is_active', true)
            ->value('balance_minor');

        if ($balance === null) {
            throw new RuntimeException('Active ledger account not found.');
        }

        return (int) $balance;
    }
}
