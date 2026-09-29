<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vehicles', function (Blueprint $table) {
            $table->id();

            $table->foreignId('rider_profile_id')
                ->constrained('rider_profiles')
                ->cascadeOnDelete();

            $table->enum('vehicle_type', [
                'motorcycle',
                'car',
                'van',
                'truck',
            ]);

            $table->string('make')->nullable();
            $table->string('model')->nullable();
            $table->string('year')->nullable();

            $table->string('color')->nullable();
            $table->string('plate_number')->unique();

            $table->string('registration_number')->nullable();
            $table->date('registration_expiry')->nullable();

            $table->enum('verification_status', [
                'pending',
                'verified',
                'rejected',
            ])->default('pending');

            $table->text('rejection_reason')->nullable();

            $table->boolean('is_active')->default(true);

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicles');
    }
};