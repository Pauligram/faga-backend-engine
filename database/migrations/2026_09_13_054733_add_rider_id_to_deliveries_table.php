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
        Schema::table('deliveries', function (Blueprint $table) {
            $table->foreignId('rider_id')
                ->nullable()
                ->after('customer_id')
                ->constrained('users')
                ->nullOnDelete();
        });
    }

    /**
     * Reverse the migration.
     */
    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropForeign(['rider_id']);
            $table->dropColumn('rider_id');
        });
    }
};