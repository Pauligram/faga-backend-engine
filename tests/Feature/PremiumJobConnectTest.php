<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

class PremiumJobConnectTest extends TestCase
{
    use RefreshDatabase;

    public function test_an_employer_can_purchase_premium_recruitment_features()
    {
        // 1. Setup mock user credentials profile
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        // 2. Open an active wallet row and load it with ₦20,000 cash balance
        DB::table('wallets')->insert([
            'user_id'        => $user->id,
            'balance'        => 20000.00,
            'escrow_balance' => 0.00,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        $payload = [
            'plan_name' => 'PREMIUM_MONTHLY_RECRUITER',
            'amount'    => 15000.00 // Recruiter package cost is ₦15,000
        ];

        // 3. FIRE! Submit the recruitment subscription request down to the endpoint channels
        $response = $this->postJson('/api/jobs/premium-subscription', $payload);

        // 4. ASSERT CHECKS: Expect a 200 OK success response header
        $response->assertStatus(200);
        $response->assertJson(['success' => true]);

        // Check employer wallet: Spending pocket must drop from ₦20,000 to exactly ₦5,000
        $updatedWallet = DB::table('wallets')->where('user_id', $user->id)->first();
        $this->assertEquals(5000.00, $updatedWallet->balance);

        // Verify that the financial bookkeeping ledgers caught the transaction log cleanly
        $this->assertDatabaseHas('financial_ledgers', [
            'user_id'          => $user->id,
            'transaction_type' => 'RECRUITMENT_PREMIUM_DEBIT'
        ]);
    }
}
