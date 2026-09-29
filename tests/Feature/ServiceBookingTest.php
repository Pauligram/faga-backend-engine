<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

class ServiceBookingTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_customer_can_place_a_food_or_service_order_and_lock_escrow_funds()
    {
        // 1. Setup mock customer credentials profile
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        // 2. Open an active wallet row and load it with ₦10,000 cash balance
        DB::table('wallets')->insert([
            'user_id'        => $user->id,
            'balance'        => 10000.00,
            'escrow_balance' => 0.00,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        $payload = [
            'order_type'           => 'FOOD',
            'item_or_service_name' => 'Crispy Chicken Fest Pack',
            'total_amount'         => 4500.00 // Total cost is ₦4,500
        ];

        // 3. FIRE! Submit the booking request data down to the services route endpoint channel
        $response = $this->postJson('/api/services/book', $payload);

        // 4. ASSERT CHECKS: Expect a 201 created status response header
        $response->assertStatus(201);
        $response->assertJson(['success' => true]);

        // Check customer wallet: Spending pocket must drop to ₦5,500, Escrow safe must lock up exactly ₦4,500
        $updatedWallet = DB::table('wallets')->where('user_id', $user->id)->first();
        $this->assertEquals(5500.00, $updatedWallet->balance);
        $this->assertEquals(4500.00, $updatedWallet->escrow_balance);

        // Verify that the table officially holds this structural transaction record row
        $this->assertDatabaseHas('service_orders', [
            'user_id'              => $user->id,
            'item_or_service_name' => 'Crispy Chicken Fest Pack',
            'payment_status'       => 'HELD_IN_ESCROW'
        ]);
    }
}
