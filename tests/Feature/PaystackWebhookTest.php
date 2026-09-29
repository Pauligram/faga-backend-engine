<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Models\Ride;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;

class PaystackWebhookTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_processes_a_valid_paystack_webhook_receipt_and_updates_payment_status()
    {
        // 1. Setup a controlled mock secret key for encryption validation checks
        $mockSecret = 'sk_test_mock_secret_key_faga_2026';
        Config::set('services.paystack.secret_key', $mockSecret);

        // 2. Setup a dummy user and a ride order with a unique payment reference tag
        $user = User::factory()->create();
        
        // Ensure your database schema handles this reference tracking
        $ride = Ride::create([
            'user_id' => $user->id,
            'status' => 'ACCEPTED',
            'pickup_address' => 'Start Point',
            'dropoff_address' => 'End Point'
        ]);

        // Manually attach a mock tracking payment reference and status to our ride table row
        DB::table('rides')->where('id', $ride->id)->update([
            'payment_reference' => 'REF_FAGA_TRIP_777',
            'payment_status' => 'UNPAID'
        ]);

        // 3. Construct the simulated Paystack electronic receipt package body
        $payload = [
            'event' => 'charge.success',
            'data' => [
                'reference' => 'REF_FAGA_TRIP_777',
                'amount' => 450000, // 4,500 NGN in Kobo units
                'status' => 'success',
                'currency' => 'NGN'
            ]
        ];

        $jsonPayload = json_encode($payload);

        // Calculate the cryptographic SHA512 signature using our mock secret key
        $validSignature = hash_hmac('sha512', $jsonPayload, $mockSecret);

        // 4. FIRE! Send the payload request to your webhook pathway endpoint
        $response = $this->withHeaders([
            'x-paystack-signature' => $validSignature,
            'Content-Type' => 'application/json',
            'Accept' => 'application/json'
        ])->postJson('/api/payments/webhook/paystack', $payload);

        // 5. ASSERT CHECKS: Make sure the server returns a 200 OK success receipt code
        $response->assertStatus(200);
        $response->assertJson(['status' => 'success']);

        // Check if the ride order's payment status was automatically flipped to PAID in the database
        $updatedRide = DB::table('rides')->where('id', $ride->id)->first();
        $this->assertEquals('PAID', $updatedRide->payment_status);
    }
}
