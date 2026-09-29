<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Models\Ride;
use App\Models\Dispute;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

class AdminDisputeTest extends TestCase
{
    use RefreshDatabase;

    public function test_an_admin_can_successfully_update_and_resolve_a_dispute_ticket()
    {
        // 1. Setup a fake user, ride, and an open dispute ticket
        $user = User::factory()->create();
        $ride = Ride::create([
            'user_id' => $user->id,
            'status' => 'ACCEPTED',
            'pickup_address' => 'Point A',
            'dropoff_address' => 'Point B'
        ]);

        $dispute = Dispute::create([
            'user_id' => $user->id,
            'ride_id' => $ride->id,
            'reason' => 'Driver did not arrive',
            'description' => 'I waited for 30 minutes but no one came.',
            'status' => 'OPEN'
        ]);

        // 2. Log in as an admin mock context
        Sanctum::actingAs($user);

        // 3. Admin updates the ticket using the form values from our dashboard popup modal
        $updatePayload = [
            'status' => 'RESOLVED',
            'resolution_action' => 'REFUND_CUSTOMER',
            'admin_notes' => 'Investigation complete. Verified driver cancellation.'
        ];

        // 4. FIRE! Send the changes to the dispute route endpoint
        $response = $this->patchJson("/api/admin/disputes/{$dispute->id}/resolve", $updatePayload);

        // 5. ASSERT CHECKS: Make sure the server returns success and updates the database row status
        $response->assertStatus(200);
        $response->assertJson(['success' => true]);

        $this->assertDatabaseHas('disputes', [
            'id' => $dispute->id,
            'status' => 'RESOLVED',
            'resolution_action' => 'REFUND_CUSTOMER'
        ]);
    }
}
