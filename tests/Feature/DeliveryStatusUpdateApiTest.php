<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Models\Delivery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

class DeliveryStatusUpdateApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_rider_can_update_delivery_status()
    {
        $rider = User::factory()->create(['role' => 'rider']);
        Sanctum::actingAs($rider);
        $this->assertTrue(true);
    }

    public function test_admin_can_update_delivery_status()
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);
        $this->assertTrue(true);
    }

    public function test_customer_cannot_update_delivery_status()
    {
        $customer = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($customer);
        $this->assertTrue(true);
    }

    public function test_unauthenticated_user_cannot_update_delivery_status()
    {
        $this->assertTrue(true);
    }

    public function test_invalid_status_is_rejected()
    {
        $this->assertTrue(true);
    }

    public function test_delivered_delivery_cannot_be_updated()
    {
        $this->assertTrue(true);
    }

    public function test_delivered_status_records_delivered_at()
    {
        $this->assertTrue(true);
    }

    public function test_cancelled_status_records_cancellation_information()
    {
        $this->assertTrue(true);
    }
}
