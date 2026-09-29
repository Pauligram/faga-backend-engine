<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class SellerApplicationApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_customer_can_submit_seller_application(): void
    {
        $user = User::factory()->create([
            'role' => 'customer',
            'is_active' => true,
        ]);

        $user->roles()->create([
            'role' => 'customer',
        ]);

        $response = $this
            ->actingAs($user)
            ->postJson('/api/seller-applications', [
                'business_name' => 'Test FAGA Store',
                'business_email' => 'store@test.com',
                'business_phone' => '08044444444',
                'business_address' => '15 Test Business Street',
                'city' => 'Lagos',
                'state' => 'Lagos',
                'country' => 'Nigeria',
                'business_registration_number' => 'RC-TEST-001',
                'tax_identification_number' => 'TIN-TEST-001',
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath(
                'message',
                'Seller application submitted successfully.'
            )
            ->assertJsonPath(
                'application.business_name',
                'Test FAGA Store'
            )
            ->assertJsonPath(
                'application.application_status',
                'pending'
            );

        $this->assertDatabaseHas('seller_applications', [
            'user_id' => $user->id,
            'business_name' => 'Test FAGA Store',
            'business_phone' => '08044444444',
            'application_status' => 'pending',
        ]);
    }

    public function test_customer_can_view_latest_seller_application(): void
    {
        $user = User::factory()->create([
            'role' => 'customer',
            'is_active' => true,
        ]);

        $user->roles()->create([
            'role' => 'customer',
        ]);

        $user->sellerApplications()->create([
            'business_name' => 'Test Seller Business',
            'business_email' => 'seller@test.com',
            'business_phone' => '08055555555',
            'business_address' => '20 Seller Street',
            'city' => 'Lagos',
            'state' => 'Lagos',
            'country' => 'Nigeria',
            'application_status' => 'pending',
        ]);

        $response = $this
            ->actingAs($user)
            ->getJson('/api/seller-applications/me');

        $response
            ->assertOk()
            ->assertJsonPath(
                'application.business_name',
                'Test Seller Business'
            )
            ->assertJsonPath(
                'application.application_status',
                'pending'
            );
    }

    public function test_customer_cannot_submit_duplicate_active_seller_applications(): void
    {
        $user = User::factory()->create([
            'role' => 'customer',
            'is_active' => true,
        ]);

        $user->roles()->create([
            'role' => 'customer',
        ]);

        $user->sellerApplications()->create([
            'business_name' => 'Existing Business',
            'business_phone' => '08066666666',
            'application_status' => 'pending',
        ]);

        $response = $this
            ->actingAs($user)
            ->postJson('/api/seller-applications', [
                'business_name' => 'Another Business',
                'business_phone' => '08077777777',
            ]);

        $response
            ->assertStatus(422)
            ->assertJsonPath(
                'message',
                'You already have an active seller application.'
            );
    }

    public function test_existing_seller_cannot_submit_seller_application(): void
    {
        $user = User::factory()->create([
            'role' => 'seller',
            'is_active' => true,
        ]);

        $user->roles()->create([
            'role' => 'seller',
        ]);

        $response = $this
            ->actingAs($user)
            ->postJson('/api/seller-applications', [
                'business_name' => 'Already Seller Business',
                'business_phone' => '08088888888',
            ]);

        $response
            ->assertStatus(422)
            ->assertJsonPath(
                'message',
                'You are already registered as a seller.'
            );
    }

    public function test_seller_application_validation_works(): void
    {
        $user = User::factory()->create([
            'role' => 'customer',
            'is_active' => true,
        ]);

        $user->roles()->create([
            'role' => 'customer',
        ]);

        $response = $this
            ->actingAs($user)
            ->postJson('/api/seller-applications', [
                'business_email' => 'not-an-email',
            ]);

        $response
            ->assertStatus(422)
            ->assertJsonValidationErrors([
                'business_name',
                'business_phone',
                'business_email',
            ]);
    }
}