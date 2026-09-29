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
        Schema::create('job_postings', function (Blueprint $table) {
            $table->id();

            /*
            |--------------------------------------------------------------------------
            | Person who posted the job
            |--------------------------------------------------------------------------
            */
            $table->foreignId('posted_by')
                ->constrained('users')
                ->cascadeOnDelete();

            /*
            |--------------------------------------------------------------------------
            | Basic job information
            |--------------------------------------------------------------------------
            */
            $table->string('title');
            $table->string('company_name')->nullable();

            $table->text('description');

            /*
            |--------------------------------------------------------------------------
            | Job category and employment type
            |--------------------------------------------------------------------------
            */
            $table->string('category');
            $table->string('employment_type');

            /*
            |--------------------------------------------------------------------------
            | Job location
            |--------------------------------------------------------------------------
            */
            $table->string('location');
            $table->string('state')->nullable();
            $table->string('country')->default('Nigeria');

            /*
            |--------------------------------------------------------------------------
            | Salary
            |--------------------------------------------------------------------------
            */
            $table->decimal('salary_min', 12, 2)->nullable();
            $table->decimal('salary_max', 12, 2)->nullable();
            $table->string('salary_period')->nullable();

            /*
            |--------------------------------------------------------------------------
            | Requirements and responsibilities
            |--------------------------------------------------------------------------
            */
            $table->text('requirements')->nullable();
            $table->text('responsibilities')->nullable();

            /*
            |--------------------------------------------------------------------------
            | Application information
            |--------------------------------------------------------------------------
            */
            $table->date('application_deadline')->nullable();

            /*
            |--------------------------------------------------------------------------
            | Job status
            |--------------------------------------------------------------------------
            */
            $table->string('status')->default('open');

            /*
            |--------------------------------------------------------------------------
            | Contact information
            |--------------------------------------------------------------------------
            */
            $table->string('contact_email')->nullable();
            $table->string('contact_phone')->nullable();

            $table->timestamps();

            /*
            |--------------------------------------------------------------------------
            | Indexes for faster job searching
            |--------------------------------------------------------------------------
            */
            $table->index('status');
            $table->index('category');
            $table->index('employment_type');
            $table->index('location');
        });
    }

    /**
     * Reverse the migration.
     */
    public function down(): void
    {
        Schema::dropIfExists('job_postings');
    }
};