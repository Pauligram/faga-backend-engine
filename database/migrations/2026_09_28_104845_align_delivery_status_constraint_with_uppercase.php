<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Convert existing records before applying the new constraint.
        DB::statement(
            'ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_status_check'
        );

        DB::statement(
            'UPDATE deliveries SET status = UPPER(status)'
        );

        DB::statement("
            ALTER TABLE deliveries
            ADD CONSTRAINT deliveries_status_check
            CHECK (status IN (
                'PENDING_PAYMENT',
                'CONFIRMED',
                'SEARCHING_FOR_RIDER',
                'RIDER_ASSIGNED',
                'RIDER_EN_ROUTE_TO_PICKUP',
                'ARRIVED_AT_PICKUP',
                'PICKED_UP',
                'IN_TRANSIT',
                'ARRIVED_AT_DROPOFF',
                'DELIVERED',
                'CANCELLED',
                'FAILED'
            ))
        ");
    }

    public function down(): void
    {
        DB::statement(
            'ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_status_check'
        );

        DB::statement(
            'UPDATE deliveries SET status = LOWER(status)'
        );

        DB::statement("
            ALTER TABLE deliveries
            ADD CONSTRAINT deliveries_status_check
            CHECK (status IN (
                'pending_payment',
                'confirmed',
                'searching_for_rider',
                'rider_assigned',
                'rider_en_route_to_pickup',
                'arrived_at_pickup',
                'picked_up',
                'in_transit',
                'arrived_at_dropoff',
                'delivered',
                'cancelled',
                'failed'
            ))
        ");
    }
};