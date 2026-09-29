<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

class MarketplacePurchaseTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_customer_can_buy_a_marketplace_product_and_lock_money_in_escrow()
    {
        // 1. Create a fake customer profile
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        // 2. Open an active wallet row and load it with ₦15,000 cash balance
        DB::table('wallets')->insert([
            'user_id'        => $user->id,
            'balance'        => 15000.00,
            'escrow_balance' => 0.00,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        $payload = [
            'seller_id'    => 99, // Fake merchant vendor ID code
            'product_name' => 'Poloshirt Cotton Bundle',
            'price'        => 6500.00 // Item cost is ₦6,500
        ];

        // 3. FIRE! Submit purchase data to the marketplace endpoint channel
        $response = $this->postJson('/api/marketplace/purchase', $payload);

        // 4. ASSERT CHECKS: Expect a 201 created status response header
        $response->assertStatus(201);
        $response->assertJson(['success' => true]);

        // Check customer wallet: Spending pocket must drop to ₦8,500, Escrow safe must lock up exactly ₦6,500
        $updatedWallet = DB::table('wallets')->where('user_id', $user->id)->first();
        $this->assertEquals(8500.00, $updatedWallet->balance);
        $this->assertEquals(6500.00, $updatedWallet->escrow_balance);

        // Verify that the marketplace table officially has this transaction logged
        $this->assertDatabaseHas('marketplace_orders', [
            'user_id'        => $user->id,
            'product_name'   => 'Poloshirt Cotton Bundle',
            'payment_status' => 'HELD_IN_ESCROW'
        ]);
    }
}
