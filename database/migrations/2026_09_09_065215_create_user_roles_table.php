<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_roles', function (Blueprint $table) {
            $table->id();

            $table->foreignId('user_id')
                ->constrained('users')
                ->cascadeOnDelete();

            $table->enum('role', [
                'customer',
                'rider',
                'seller',
                'service_provider',
                'admin',
                'super_admin',
            ]);

            $table->timestamps();

            $table->unique(['user_id', 'role']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_roles');
    }
};