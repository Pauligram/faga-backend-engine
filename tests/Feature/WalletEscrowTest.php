<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Services\Finance\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

class WalletEscrowTest extends TestCase
{
    use RefreshDatabase;

    public function test_money_can_be_locked_in_escrow_and_released_to_a_driver()
    {
        // 1. Create a fake Customer and a fake Driver account
        $customer = User::factory()->create();
        $driver   = User::factory()->create();

        // 2. Open up database wallets for both accounts with starting balances
        DB::table('wallets')->insert([
            'user_id'        => $customer->id,
            'balance'        => 5000.00, // Customer starts with 5,000 NGN
            'escrow_balance' => 0.00,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        DB::table('wallets')->insert([
            'user_id'        => $driver->id,
            'balance'        => 0.00,    // Driver starts with 0 NGN
            'escrow_balance' => 0.00,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        // 3. Fire up our Wallet Service tool
        $walletService = new WalletService();

        // TEST ACTION A: Lock 3,500 NGN into the escrow safe for a trip booking
        $lockSuccess = $walletService->lockEscrow($customer->id, 3500.00);
        $this->assertTrue($lockSuccess);

        // Check customer wallet: spending money should be 1,500 and escrow safe should have 3,500
        $customerWallet = DB::table('wallets')->where('user_id', $customer->id)->first();
        $this->assertEquals(1500.00, $customerWallet->balance);
        $this->assertEquals(3500.00, $customerWallet->escrow_balance);

        // TEST ACTION B: Release that 3,500 NGN from escrow directly to the driver
        $releaseSuccess = $walletService->releaseEscrow($customer->id, $driver->id, 3500.00);
        $this->assertTrue($releaseSuccess);

        // Check final states: Customer escrow is empty, Driver spending pocket has 3,500 NGN!
        $customerWalletAfter = DB::table('wallets')->where('user_id', $customer->id)->first();
        $driverWalletAfter   = DB::table('wallets')->where('user_id', $driver->id)->first();

        $this->assertEquals(0.00, $customerWalletAfter->escrow_balance);
        $this->assertEquals(3500.00, $driverWalletAfter->balance);
    }
}
