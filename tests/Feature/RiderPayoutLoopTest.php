<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Models\Delivery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

class RiderPayoutLoopTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_rider_can_complete_delivery_and_receive_escrow_funds_instantly()
    {
        // 1. Setup fake customer and rider profiles
        $customer = User::factory()->create();
        $rider    = User::factory()->create();

        // 2. Log in as our authenticated rider
        Sanctum::actingAs($rider);

        // 3. Pre-load wallets inside the database: Customer holds ₦4,000 locked inside escrow
        DB::table('wallets')->insert([
            'user_id'        => $customer->id,
            'balance'        => 0.00,
            'escrow_balance' => 4000.00,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        DB::table('wallets')->insert([
            'user_id'        => $rider->id,
            'balance'        => 0.00, // Rider starts empty
            'escrow_balance' => 0.00,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        // 4. Create an active delivery tracking record sitting in transit
        $delivery = Delivery::create([
            'user_id'          => $customer->id,
            'status'           => 'IN_TRANSIT',
            'pickup_address'   => 'Warehouse Point A',
            'delivery_address' => 'Customer Point B'
        ]);

        // 5. FIRE! Submit request to execute completion payout loop route channel
        $response = $this->postJson("/api/rider/deliveries/{$delivery->id}/complete");

        // 6. ASSERT CHECKS: Verify the server returns code 200 OK success
        $response->assertStatus(200);
        $response->assertJson(['success' => true]);

        // Verify database states: Customer escrow emptied out completely
        $customerWallet = DB::table('wallets')->where('user_id', $customer->id)->first();
        $this->assertEquals(0.00, $customerWallet->escrow_balance);

        // Verify database states: Rider main balance successfully loaded up with ₦4,000!
        $riderWallet = DB::table('wallets')->where('user_id', $rider->id)->first();
        $this->assertEquals(4000.00, $riderWallet->balance);

        // Verify status check constraint string officially updated to pure uppercase DELIVERED
        $updatedDelivery = DB::table('deliveries')->where('id', $delivery->id)->first();
        $this->assertEquals('DELIVERED', $updatedDelivery->status);
    }
}
