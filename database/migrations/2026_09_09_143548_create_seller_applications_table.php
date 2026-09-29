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
        Schema::create('seller_applications', function (Blueprint $table) {
            $table->id();

            $table->foreignId('user_id')
                ->constrained('users')
                ->cascadeOnDelete();

            // Business information
            $table->string('business_name');
            $table->string('business_email')->nullable();
            $table->string('business_phone');

            $table->text('business_address')->nullable();

            $table->string('city')->nullable();
            $table->string('state')->nullable();
            $table->string('country')->default('Nigeria');

            // Business registration
            $table->string('business_registration_number')->nullable();
            $table->string('tax_identification_number')->nullable();

            // Application status
            $table->enum('application_status', [
                'pending',
                'under_review',
                'approved',
                'rejected',
            ])->default('pending');

            $table->text('rejection_reason')->nullable();

            // Admin review
            $table->foreignId('reviewed_by')
                ->nullable()
                ->constrained('users')
                ->nullOnDelete();

            $table->timestamp('reviewed_at')->nullable();

            $table->timestamps();

            $table->index(['user_id', 'application_status']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('seller_applications');
    }
};