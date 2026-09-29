<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Models\Ride;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

class RidePayoutLoopTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_driver_can_complete_ride_and_receive_escrow_funds_instantly()
    {
        // 1. Setup fake customer and driver profiles
        $customer = User::factory()->create();
        $driver   = User::factory()->create();

        // 2. Log in as our authenticated driver
        Sanctum::actingAs($driver);

        // 3. Pre-load wallets inside the database: Customer holds ₦2,500 locked inside escrow
        DB::table('wallets')->insert([
            'user_id'        => $customer->id,
            'balance'        => 0.00,
            'escrow_balance' => 2500.00,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        DB::table('wallets')->insert([
            'user_id'        => $driver->id,
            'balance'        => 0.00, // Driver starts empty
            'escrow_balance' => 0.00,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        // 4. Create an active ride tracking record sitting in transit
        $ride = Ride::create([
            'user_id'         => $customer->id,
            'status'          => 'IN_TRANSIT',
            'pickup_address'  => 'Allen Avenue, Ikeja',
            'dropoff_address' => 'Admiralty Way, Lekki'
        ]);

        // 5. FIRE! Submit request to execute completion payout loop route channel
        $response = $this->postJson("/api/rider/rides/{$ride->id}/complete");

        // 6. ASSERT CHECKS: Verify the server returns code 200 OK success
        $response->assertStatus(200);
        $response->assertJson(['success' => true]);

        // Verify database states: Customer escrow emptied out completely
        $customerWallet = DB::table('wallets')->where('user_id', $customer->id)->first();
        $this->assertEquals(0.00, $customerWallet->escrow_balance);

        // Verify database states: Driver main balance successfully loaded up with ₦2,500!
        $driverWallet = DB::table('wallets')->where('user_id', $driver->id)->first();
        $this->assertEquals(2500.00, $driverWallet->balance);

        // Verify status string officially updated to pure uppercase COMPLETED
        $updatedRide = DB::table('rides')->where('id', $ride->id)->first();
        $this->assertEquals('COMPLETED', $updatedRide->status);
    }
}
