<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RiderApplicationApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_customer_can_submit_rider_application(): void
    {
        $user = User::factory()->create([
            'role' => 'customer',
            'is_active' => true,
        ]);

        $user->roles()->create([
            'role' => 'customer',
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/rider-applications', [
            'full_name' => 'Test Rider Applicant',
            'phone' => '08012345678',
            'date_of_birth' => '1995-05-10',
            'gender' => 'male',
            'address' => 'Lagos, Nigeria',
            'emergency_contact_name' => 'Emergency Contact',
            'emergency_contact_phone' => '08087654321',
        ]);

        $response
            ->assertCreated()
            ->assertJson([
                'message' => 'Rider application submitted successfully.',
                'application' => [
                    'application_status' => 'pending',
                ],
            ]);

        $this->assertDatabaseHas('rider_applications', [
            'user_id' => $user->id,
            'full_name' => 'Test Rider Applicant',
            'phone' => '08012345678',
            'application_status' => 'pending',
        ]);
    }

    public function test_customer_can_view_latest_rider_application(): void
    {
        $user = User::factory()->create([
            'role' => 'customer',
            'is_active' => true,
        ]);

        $user->roles()->create([
            'role' => 'customer',
        ]);

        Sanctum::actingAs($user);

        $this->postJson('/api/rider-applications', [
            'full_name' => 'Test Rider Applicant',
            'phone' => '08012345678',
        ])->assertCreated();

        $response = $this->getJson('/api/rider-applications/me');

        $response
            ->assertOk()
            ->assertJson([
                'application' => [
                    'full_name' => 'Test Rider Applicant',
                    'phone' => '08012345678',
                    'application_status' => 'pending',
                ],
            ]);
    }

    public function test_customer_cannot_submit_duplicate_active_application(): void
    {
        $user = User::factory()->create([
            'role' => 'customer',
            'is_active' => true,
        ]);

        $user->roles()->create([
            'role' => 'customer',
        ]);

        Sanctum::actingAs($user);

        $this->postJson('/api/rider-applications', [
            'full_name' => 'Test Rider Applicant',
            'phone' => '08012345678',
        ])->assertCreated();

        $response = $this->postJson('/api/rider-applications', [
            'full_name' => 'Another Application',
            'phone' => '08099999999',
        ]);

        $response
            ->assertStatus(422)
            ->assertJson([
                'message' => 'You already have an active rider application.',
            ]);
    }

    public function test_existing_rider_cannot_submit_rider_application(): void
    {
        $user = User::factory()->create([
            'role' => 'rider',
            'is_active' => true,
        ]);

        $user->roles()->create([
            'role' => 'rider',
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/rider-applications', [
            'full_name' => 'Existing Rider',
            'phone' => '08012345678',
        ]);

        $response
            ->assertStatus(422)
            ->assertJson([
                'message' => 'You are already registered as a rider.',
            ]);
    }
}