<?php

namespace Tests\Feature;

use App\Models\SellerApplication;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminSellerApplicationApiTest extends TestCase
{
    use RefreshDatabase;

    private function createAdmin(): User
    {
        $admin = User::factory()->create([
            'name' => 'FAGA Admin',
            'email' => 'admin@test.com',
            'role' => 'admin',
            'is_active' => true,
        ]);

        $admin->roles()->create([
            'role' => 'admin',
        ]);

        return $admin;
    }

    private function createCustomer(): User
    {
        $customer = User::factory()->create([
            'role' => 'customer',
            'is_active' => true,
        ]);

        $customer->roles()->create([
            'role' => 'customer',
        ]);

        return $customer;
    }

    private function createSellerApplication(User $user): SellerApplication
    {
        return $user->sellerApplications()->create([
            'business_name' => 'Test FAGA Store',
            'business_email' => 'store@test.com',
            'business_phone' => '08044444444',
            'business_address' => '15 Test Business Street',
            'city' => 'Lagos',
            'state' => 'Lagos',
            'country' => 'Nigeria',
            'business_registration_number' => 'RC-TEST-001',
            'tax_identification_number' => 'TIN-TEST-001',
            'application_status' => 'pending',
        ]);
    }

    public function test_admin_can_list_seller_applications(): void
    {
        $admin = $this->createAdmin();
        $customer = $this->createCustomer();

        $this->createSellerApplication($customer);

        $response = $this
            ->actingAs($admin)
            ->getJson('/api/admin/seller-applications');

        $response
            ->assertOk()
            ->assertJsonCount(1, 'applications')
            ->assertJsonPath(
                'applications.0.business_name',
                'Test FAGA Store'
            );
    }

    public function test_admin_can_view_seller_application(): void
    {
        $admin = $this->createAdmin();
        $customer = $this->createCustomer();

        $application = $this->createSellerApplication($customer);

        $response = $this
            ->actingAs($admin)
            ->getJson(
                "/api/admin/seller-applications/{$application->id}"
            );

        $response
            ->assertOk()
            ->assertJsonPath(
                'application.id',
                $application->id
            )
            ->assertJsonPath(
                'application.business_name',
                'Test FAGA Store'
            );
    }

    public function test_admin_can_mark_seller_application_under_review(): void
    {
        $admin = $this->createAdmin();
        $customer = $this->createCustomer();

        $application = $this->createSellerApplication($customer);

        $response = $this
            ->actingAs($admin)
            ->postJson(
                "/api/admin/seller-applications/{$application->id}/review"
            );

        $response
            ->assertOk()
            ->assertJsonPath(
                'message',
                'Seller application is now under review.'
            )
            ->assertJsonPath(
                'application.application_status',
                'under_review'
            );

        $this->assertDatabaseHas('seller_applications', [
            'id' => $application->id,
            'application_status' => 'under_review',
            'reviewed_by' => $admin->id,
        ]);
    }

    public function test_admin_can_approve_seller_application(): void
    {
        $admin = $this->createAdmin();
        $customer = $this->createCustomer();

        $application = $this->createSellerApplication($customer);

        $response = $this
            ->actingAs($admin)
            ->postJson(
                "/api/admin/seller-applications/{$application->id}/approve"
            );

        $response
            ->assertOk()
            ->assertJsonPath(
                'message',
                'Seller application approved successfully.'
            )
            ->assertJsonPath(
                'application.application_status',
                'approved'
            )
            ->assertJsonPath(
                'user.roles.0.role',
                'customer'
            );

        $this->assertDatabaseHas('seller_applications', [
            'id' => $application->id,
            'application_status' => 'approved',
            'reviewed_by' => $admin->id,
        ]);

        $this->assertDatabaseHas('user_roles', [
            'user_id' => $customer->id,
            'role' => 'seller',
        ]);

        $this->assertDatabaseHas('users', [
            'id' => $customer->id,
            'role' => 'seller',
        ]);

        $this->assertDatabaseHas('seller_profiles', [
            'user_id' => $customer->id,
            'business_name' => 'Test FAGA Store',
            'business_email' => 'store@test.com',
            'business_phone' => '08044444444',
            'city' => 'Lagos',
            'state' => 'Lagos',
            'verification_status' => 'pending',
            'is_active' => true,
        ]);
    }

    public function test_admin_can_reject_seller_application(): void
    {
        $admin = $this->createAdmin();
        $customer = $this->createCustomer();

        $application = $this->createSellerApplication($customer);

        $response = $this
            ->actingAs($admin)
            ->postJson(
                "/api/admin/seller-applications/{$application->id}/reject",
                [
                    'rejection_reason' =>
                        'Required business information is incomplete.',
                ]
            );

        $response
            ->assertOk()
            ->assertJsonPath(
                'message',
                'Seller application rejected.'
            )
            ->assertJsonPath(
                'application.application_status',
                'rejected'
            )
            ->assertJsonPath(
                'application.rejection_reason',
                'Required business information is incomplete.'
            );

        $this->assertDatabaseHas('seller_applications', [
            'id' => $application->id,
            'application_status' => 'rejected',
            'rejection_reason' =>
                'Required business information is incomplete.',
            'reviewed_by' => $admin->id,
        ]);
    }

    public function test_customer_cannot_access_admin_seller_application_endpoints(): void
    {
        $customer = $this->createCustomer();
        $application = $this->createSellerApplication($customer);

        $this
            ->actingAs($customer)
            ->getJson('/api/admin/seller-applications')
            ->assertForbidden();

        $this
            ->actingAs($customer)
            ->getJson(
                "/api/admin/seller-applications/{$application->id}"
            )
            ->assertForbidden();

        $this
            ->actingAs($customer)
            ->postJson(
                "/api/admin/seller-applications/{$application->id}/review"
            )
            ->assertForbidden();

        $this
            ->actingAs($customer)
            ->postJson(
                "/api/admin/seller-applications/{$application->id}/approve"
            )
            ->assertForbidden();

        $this
            ->actingAs($customer)
            ->postJson(
                "/api/admin/seller-applications/{$application->id}/reject",
                [
                    'rejection_reason' => 'Test rejection',
                ]
            )
            ->assertForbidden();
    }
}