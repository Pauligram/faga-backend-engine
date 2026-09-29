<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_applications', function (Blueprint $table) {
            $table->id();

            $table->foreignId('user_id')
                ->constrained('users')
                ->cascadeOnDelete();

            // Personal information
            $table->string('full_name');
            $table->string('phone');
            $table->date('date_of_birth')->nullable();
            $table->string('gender')->nullable();
            $table->text('address')->nullable();

            // Emergency contact
            $table->string('emergency_contact_name')->nullable();
            $table->string('emergency_contact_phone')->nullable();

            // Rider application
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

    public function down(): void
    {
        Schema::dropIfExists('rider_applications');
    }
};