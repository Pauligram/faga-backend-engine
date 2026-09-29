<?php

namespace App\Services\Finance;

use Illuminate\Support\Facades\DB;
use Exception;

class WalletService
{
    /**
     * Lock money from the user's main balance into the secure escrow container.
     */
    public function lockEscrow(int $userId, float $amount): bool
    {
        return DB::transaction(function () use ($userId, $amount) {
            // 1. Find the user's wallet record in the database
            $wallet = DB::table('wallets')->where('user_id', $userId)->lockForUpdate()->first();

            if (!$wallet) {
                throw new Exception("Wallet record not found for this user account.");
            }

            // 2. Check if the user has enough money to cover the trip cost
            if ($wallet->balance < $amount) {
                throw new Exception("Insufficient wallet funds to complete secure booking.");
            }

            // 3. Subtract from available balance and move it to the secure escrow box
            DB::table('wallets')
                ->where('user_id', $userId)
                ->update([
                    'balance' => $wallet->balance - $amount,
                    'escrow_balance' => $wallet->escrow_balance + $amount,
                    'updated_at' => now()
                ]);

            return true;
        });
    }

    /**
     * Release the locked escrow money to the service provider (Driver/Seller) when the trip is successful.
     */
    public function releaseEscrow(int $customerId, int $providerId, float $amount): bool
    {
        return DB::transaction(function () use ($customerId, $providerId, $amount) {
            // 1. Fetch both wallet rows cleanly
            $customerWallet = DB::table('wallets')->where('user_id', $customerId)->lockForUpdate()->first();
            $providerWallet = DB::table('wallets')->where('user_id', $providerId)->lockForUpdate()->first();

            if (!$customerWallet || !$providerWallet) {
                throw new Exception("Operational failure identifying wallet profiles.");
            }

            if ($customerWallet->escrow_balance < $amount) {
                throw new Exception("Discrepancy error: Escrow safe balance is lower than request.");
            }

            // 2. Empty the money from the customer's escrow box
            DB::table('wallets')
                ->where('user_id', $customerId)
                ->update([
                    'escrow_balance' => $customerWallet->escrow_balance - $amount,
                    'updated_at' => now()
                ]);

            // 3. Deposit the funds directly into the driver/seller's active pocket spend balance
            DB::table('wallets')
                ->where('user_id', $providerId)
                ->update([
                    'balance' => $providerWallet->balance + $amount,
                    'updated_at' => now()
                ]);

            return true;
        });
    }
}
