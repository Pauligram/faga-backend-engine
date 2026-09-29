<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Models\AppNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

class AppNotificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_user_can_retrieve_their_notifications_and_mark_them_as_read()
    {
        // 1. Setup mock user credentials context
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        // 2. Insert a fake alert row into our newly configured database columns
        $alert = AppNotification::create([
            'user_id' => $user->id,
            'title'   => 'Trip Dispatched',
            'message' => 'Your driver is heading to your pickup address.',
            'is_read' => false
        ]);

        // 3. TEST PATHWAY 1: Check if the user can fetch their feed list cleanly
        $getResponse = $this->getJson('/api/user/notifications');
        $getResponse->assertStatus(200);
        $getResponse->assertJsonFragment(['title' => 'Trip Dispatched']);

        // 4. TEST PATHWAY 2: Trigger the check path to flip the row to 'read'
        $patchResponse = $this->patchJson("/api/user/notifications/{$alert->id}/read");
        $patchResponse->assertStatus(200);

        // 5. ASSERT SUCCESS: Double check the database column values officially updated to true
        $this->assertDatabaseHas('app_notifications', [
            'id'      => $alert->id,
            'is_read' => true
        ]);
    }
}
