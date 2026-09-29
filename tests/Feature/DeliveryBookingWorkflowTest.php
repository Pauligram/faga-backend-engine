<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

class DeliveryBookingWorkflowTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_user_can_successfully_book_a_delivery_and_lock_funds_in_escrow()
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
            'pickup_address'   => 'Balogun Market, Lagos Island',
            'delivery_address' => 'VGC, Ajah',
            'total_cost'       => 4000.00 // Courier delivery cost is ₦4,000
        ];

        // 3. FIRE! Submit form parameters down to the delivery booking route channel endpoint
        $response = $this->postJson('/api/deliveries/book', $payload);
       


        // 4. ASSERT SUCCESS CHECK: Expect a 201 created status response header
        $response->assertStatus(201);
        $response->assertJson(['success' => true]);

        // Check customer wallet: Spending pocket must drop to ₦11,000, Escrow safe must lock up exactly ₦4,000
        $updatedWallet = DB::table('wallets')->where('user_id', $user->id)->first();
        $this->assertEquals(11000.00, $updatedWallet->balance);
        $this->assertEquals(4000.00, $updatedWallet->escrow_balance);

        // Verify notification log card record was created smoothly
        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $user->id,
            'title'   => 'Delivery Order Placed'
        ]);
    }
}
