<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('deliveries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->string('status')->default('PENDING');
            $table->string('pickup_address');
            $table->string('delivery_address');
            
            // ==========================================
            // PAYSTACK TRACKING COLUMNS ADDED HERE TOO
            // ==========================================
            $table->string('payment_reference')->nullable()->unique();
            $table->string('payment_status')->default('UNPAID'); // 'UNPAID', 'PAID'
            
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('deliveries');
    }
};
