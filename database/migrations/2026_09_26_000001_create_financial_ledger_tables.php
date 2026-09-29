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
        // 1. Create the base wallets container table
        Schema::create('wallets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade')->unique();
            $table->decimal('balance', 15, 2)->default(0.00); // Standard spending money
            $table->decimal('escrow_balance', 15, 2)->default(0.00); // Locked escrow money safe
            $table->timestamps();
        });

        // 2. Create a ledger table to log every single deposit or withdrawal for absolute bookkeeping tracking
        Schema::create('financial_ledgers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->string('transaction_type'); // 'DEPOSIT', 'WITHDRAWAL', 'ESCROW_LOCK', 'ESCROW_RELEASE'
            $table->decimal('amount', 15, 2);
            $table->string('description');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('financial_ledgers');
        Schema::dropIfExists('wallets');
    }
};
