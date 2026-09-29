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
        Schema::create('rider_profiles', function (Blueprint $table) {
            $table->id();

            $table->foreignId('user_id')
                ->unique()
                ->constrained('users')
                ->cascadeOnDelete();

            $table->string('phone')->nullable();
            $table->string('avatar')->nullable();

            $table->date('date_of_birth')->nullable();
            $table->string('gender')->nullable();

            $table->text('address')->nullable();

            $table->string('emergency_contact_name')->nullable();
            $table->string('emergency_contact_phone')->nullable();

            $table->enum('verification_status', [
                'pending',
                'verified',
                'rejected',
            ])->default('pending');

            $table->enum('availability_status', [
                'offline',
                'available',
                'busy',
            ])->default('offline');

            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('rider_profiles');
    }
};