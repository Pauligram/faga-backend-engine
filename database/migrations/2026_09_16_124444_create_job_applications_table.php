<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migration.
     */
    public function up(): void
    {
        Schema::create('job_applications', function (Blueprint $table) {
            $table->id();

            /*
            |--------------------------------------------------------------------------
            | Job being applied for
            |--------------------------------------------------------------------------
            */
            $table->foreignId('job_id')
                ->constrained('job_postings')
                ->cascadeOnDelete();

            /*
            |--------------------------------------------------------------------------
            | Person applying for the job
            |--------------------------------------------------------------------------
            */
            $table->foreignId('user_id')
                ->constrained('users')
                ->cascadeOnDelete();

            /*
            |--------------------------------------------------------------------------
            | Applicant information
            |--------------------------------------------------------------------------
            */
            $table->string('full_name');
            $table->string('email');
            $table->string('phone')->nullable();

            /*
            |--------------------------------------------------------------------------
            | Application documents / information
            |--------------------------------------------------------------------------
            */
            $table->text('cover_letter')->nullable();
            $table->string('resume_path')->nullable();

            /*
            |--------------------------------------------------------------------------
            | Application status
            |--------------------------------------------------------------------------
            */
            $table->string('status')->default('submitted');

            /*
            |--------------------------------------------------------------------------
            | Employer/admin notes
            |--------------------------------------------------------------------------
            */
            $table->text('admin_note')->nullable();

            $table->timestamps();

            /*
            |--------------------------------------------------------------------------
            | Prevent the same user from applying for the same job twice.
            |--------------------------------------------------------------------------
            */
            $table->unique(
                ['job_id', 'user_id'],
                'job_applications_job_user_unique'
            );

            /*
            |--------------------------------------------------------------------------
            | Search indexes
            |--------------------------------------------------------------------------
            */
            $table->index('status');
            $table->index('user_id');
            $table->index('job_id');
        });
    }

    /**
     * Reverse the migration.
     */
    public function down(): void
    {
        Schema::dropIfExists('job_applications');
    }
};