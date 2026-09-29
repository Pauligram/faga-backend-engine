<?php

namespace Database\Factories;

use App\Models\Delivery;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Delivery>
 */
class DeliveryFactory extends Factory
{
    protected $model = Delivery::class;

    public function definition(): array
    {
        $customer = User::factory()->create([
            'role' => 'customer',
            'is_active' => true,
        ]);

        return [
            'customer_id' => $customer->id,

            'delivery_number' => 'FAGA-DEL-' . fake()->unique()->numerify('##########'),

            'delivery_type' => 'instant',

            'status' => 'pending_payment',

            'pickup_contact_name' => 'Test Customer',
            'pickup_phone' => '08000000000',
            'pickup_address' => '12 Pickup Street',
            'pickup_city' => 'Lagos',
            'pickup_state' => 'Lagos',
            'pickup_latitude' => 6.524379,
            'pickup_longitude' => 3.379206,

            'dropoff_contact_name' => 'Test Recipient',
            'dropoff_phone' => '08111111111',
            'dropoff_address' => '25 Dropoff Street',
            'dropoff_city' => 'Lagos',
            'dropoff_state' => 'Lagos',
            'dropoff_latitude' => 6.601800,
            'dropoff_longitude' => 3.351500,

            'package_weight' => 2.50,
            'package_size' => 'medium',
            'package_description' => 'Development test package',

            'distance_km' => 0,
            'delivery_fee' => 0,
            'discount_amount' => 0,
            'total_amount' => 0,

            'payment_status' => 'pending',

            'scheduled_at' => null,

            'cancellation_reason' => null,
            'delivered_at' => null,
            'cancelled_at' => null,
        ];
    }
}