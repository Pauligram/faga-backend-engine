<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Models\Ride;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

class TelemetryTrackingTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function test_a_driver_can_send_location_and_a_customer_can_receive_it()
    {
        // 1. Create a fake user and a fake ride in our temporary test database
        $user = User::factory()->create();
        $ride = Ride::create([
            'user_id' => $user->id,
            'status' => 'ACCEPTED',
            'pickup_address' => 'Test Location Start',
            'dropoff_address' => 'Test Location End'
        ]);

        // Log the fake user into the system securely
        Sanctum::actingAs($user);

        // 2. TEST STEP A: Simulate the Driver sending a location update
        $driverPayload = [
            'ride_id'   => $ride->id,
            'latitude'  => 6.4281,  // Test location coordinate
            'longitude' => 3.4219   // Test location coordinate
        ];

        $driverResponse = $this->postJson('/api/telemetry/update', $driverPayload);

        // Assert that the server accepted the coordinates cleanly
        $driverResponse->assertStatus(200);
        $driverResponse->assertJson(['success' => true]);

        // 3. TEST STEP B: Simulate the Customer checking the broadcast tower
        $customerResponse = $this->getJson("/api/telemetry/stream/{$ride->id}");

        // Assert that the customer successfully received the exact same coordinates back
        $customerResponse->assertStatus(200);
        $customerResponse->assertJson([
            'success' => true,
            'data' => [
                'ride_id'   => $ride->id,
                'latitude'  => 6.4281,
                'longitude' => 3.4219
            ]
        ]);
    }
}
