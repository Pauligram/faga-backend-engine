<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('service_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade'); // The Buyer/Customer
            $table->string('order_type'); // 'FOOD', 'ON_DEMAND_SERVICE'
            $table->string('item_or_service_name'); // e.g., "Jollof Rice Bundle" or "AC Repair Service"
            $table->decimal('total_amount', 15, 2);
            $table->string('status')->default('PENDING_ACCEPTANCE'); // Tracking pipeline milestone
            $table->string('payment_status')->default('HELD_IN_ESCROW');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('service_orders');
    }
};
