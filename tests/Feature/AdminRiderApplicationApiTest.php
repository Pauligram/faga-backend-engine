<?php

namespace Tests\Feature;

use App\Models\RiderApplication;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminRiderApplicationApiTest extends TestCase
{
    use RefreshDatabase;

    private function createAdmin(): User
    {
        $admin = User::factory()->create([
            'role' => 'admin',
            'is_active' => true,
        ]);

        $admin->roles()->create([
            'role' => 'admin',
        ]);

        return $admin;
    }

    private function createCustomerWithApplication(): array
    {
        $customer = User::factory()->create([
            'role' => 'customer',
            'is_active' => true,
        ]);

        $customer->roles()->create([
            'role' => 'customer',
        ]);

        $application = RiderApplication::create([
            'user_id' => $customer->id,
            'full_name' => 'Test Rider Applicant',
            'phone' => '08012345678',
            'date_of_birth' => '1995-05-10',
            'gender' => 'male',
            'address' => 'Lagos, Nigeria',
            'emergency_contact_name' => 'Emergency Contact',
            'emergency_contact_phone' => '08087654321',
            'application_status' => 'pending',
        ]);

        return [$customer, $application];
    }

    public function test_admin_can_list_rider_applications(): void
    {
        [$customer, $application] = $this->createCustomerWithApplication();

        $admin = $this->createAdmin();

        Sanctum::actingAs($admin);

        $response = $this->getJson('/api/admin/rider-applications');

        $response
            ->assertOk()
            ->assertJsonCount(1, 'applications')
            ->assertJsonPath(
                'applications.0.id',
                $application->id
            );
    }

    public function test_admin_can_view_rider_application(): void
    {
        [$customer, $application] = $this->createCustomerWithApplication();

        $admin = $this->createAdmin();

        Sanctum::actingAs($admin);

        $response = $this->getJson(
            "/api/admin/rider-applications/{$application->id}"
        );

        $response
            ->assertOk()
            ->assertJsonPath(
                'application.id',
                $application->id
            )
            ->assertJsonPath(
                'application.application_status',
                'pending'
            );
    }

    public function test_admin_can_mark_application_under_review(): void
    {
        [$customer, $application] = $this->createCustomerWithApplication();

        $admin = $this->createAdmin();

        Sanctum::actingAs($admin);

        $response = $this->postJson(
            "/api/admin/rider-applications/{$application->id}/review"
        );

        $response
            ->assertOk()
            ->assertJson([
                'message' => 'Rider application is now under review.',
            ]);

        $this->assertDatabaseHas('rider_applications', [
            'id' => $application->id,
            'application_status' => 'under_review',
            'reviewed_by' => $admin->id,
        ]);
    }

    public function test_admin_can_approve_rider_application(): void
    {
        [$customer, $application] = $this->createCustomerWithApplication();

        $admin = $this->createAdmin();

        Sanctum::actingAs($admin);

        $response = $this->postJson(
            "/api/admin/rider-applications/{$application->id}/approve"
        );

        $response
            ->assertOk()
            ->assertJson([
                'message' => 'Rider application approved successfully.',
            ]);

        $this->assertDatabaseHas('rider_applications', [
            'id' => $application->id,
            'application_status' => 'approved',
            'reviewed_by' => $admin->id,
        ]);

        $this->assertDatabaseHas('user_roles', [
            'user_id' => $customer->id,
            'role' => 'rider',
        ]);

        $this->assertDatabaseHas('users', [
            'id' => $customer->id,
            'role' => 'rider',
        ]);

        $this->assertDatabaseHas('rider_profiles', [
            'user_id' => $customer->id,
            'phone' => '08012345678',
            'gender' => 'male',
            'address' => 'Lagos, Nigeria',
            'verification_status' => 'pending',
            'availability_status' => 'offline',
        ]);
    }

    public function test_admin_can_reject_rider_application(): void
    {
        [$customer, $application] = $this->createCustomerWithApplication();

        $admin = $this->createAdmin();

        Sanctum::actingAs($admin);

        $response = $this->postJson(
            "/api/admin/rider-applications/{$application->id}/reject",
            [
                'rejection_reason' => 'Required documents are incomplete.',
            ]
        );

        $response
            ->assertOk()
            ->assertJson([
                'message' => 'Rider application rejected.',
            ]);

        $this->assertDatabaseHas('rider_applications', [
            'id' => $application->id,
            'application_status' => 'rejected',
            'rejection_reason' => 'Required documents are incomplete.',
            'reviewed_by' => $admin->id,
        ]);
    }

    public function test_customer_cannot_access_admin_rider_application_endpoints(): void
    {
        [$customer, $application] = $this->createCustomerWithApplication();

        Sanctum::actingAs($customer);

        $this->getJson('/api/admin/rider-applications')
            ->assertForbidden();

        $this->getJson(
            "/api/admin/rider-applications/{$application->id}"
        )->assertForbidden();
    }
}