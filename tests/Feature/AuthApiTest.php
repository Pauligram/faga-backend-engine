<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_customer_can_register(): void
    {
        $response = $this->postJson('/api/register', [
            'name' => 'API Test Customer',
            'email' => 'api-test-customer@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response
            ->assertCreated()
            ->assertJson([
                'message' => 'Registration successful.',
            ]);

        $this->assertDatabaseHas('users', [
            'email' => 'api-test-customer@example.com',
            'role' => 'customer',
            'is_active' => true,
        ]);

        $this->assertDatabaseHas('user_roles', [
            'role' => 'customer',
        ]);

        $this->assertNotEmpty($response->json('token'));
    }

    public function test_customer_can_login(): void
    {
        $this->postJson('/api/register', [
            'name' => 'Login Test Customer',
            'email' => 'login-test@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ])->assertCreated();

        $response = $this->postJson('/api/login', [
            'email' => 'login-test@example.com',
            'password' => 'password123',
        ]);

        $response
            ->assertOk()
            ->assertJson([
                'message' => 'Login successful.',
            ]);

        $this->assertNotEmpty($response->json('token'));
    }
}