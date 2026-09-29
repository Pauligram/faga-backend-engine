<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('app_notifications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade'); // The user who owns this bulletin board
            $table->string('title');       // e.g., "Payment Confirmed!"
            $table->text('message');       // e.g., "Your payment of ₦4,500 has been verified."
            $table->boolean('is_read')->default(false); // Tracks if the user has clicked/viewed it
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('app_notifications');
    }
};
