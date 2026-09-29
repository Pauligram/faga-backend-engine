<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('marketplace_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade'); // The Buyer
            $table->unsignedBigInteger('seller_id'); // The Merchant vendor account
            $table->string('product_name');
            $table->decimal('price', 15, 2);
            $table->string('status')->default('PENDING'); // 'PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED'
            $table->string('payment_status')->default('UNPAID'); // 'UNPAID', 'HELD_IN_ESCROW', 'RELEASED'
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('marketplace_orders');
    }
};
