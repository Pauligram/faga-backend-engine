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
        Schema::create('seller_profiles', function (Blueprint $table) {
            $table->id();

            $table->foreignId('user_id')
                ->unique()
                ->constrained('users')
                ->cascadeOnDelete();

            // Business information
            $table->string('business_name');
            $table->string('business_email')->nullable();
            $table->string('business_phone')->nullable();

            $table->text('business_address')->nullable();

            $table->string('city')->nullable();
            $table->string('state')->nullable();
            $table->string('country')->default('Nigeria');

            // Business identity
            $table->string('business_registration_number')->nullable();
            $table->string('tax_identification_number')->nullable();

            // Seller branding
            $table->string('logo')->nullable();
            $table->string('cover_image')->nullable();

            // Seller status
            $table->enum('verification_status', [
                'pending',
                'verified',
                'rejected',
            ])->default('pending');

            $table->text('rejection_reason')->nullable();

            // Store status
            $table->boolean('is_active')->default(true);

            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('seller_profiles');
    }
};