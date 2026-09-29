<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('disputes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade'); // Who filed it
            $table->unsignedBigInteger('ride_id'); // Link to the specific ride
            $table->string('reason');
            $table->text('description');
            $table->string('status')->default('OPEN'); // 'OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED'
            $table->string('resolution_action')->default('NONE'); // 'NONE', 'REFUND_CUSTOMER', 'PAY_RIDER'
            $table->text('admin_notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('disputes');
    }
};
