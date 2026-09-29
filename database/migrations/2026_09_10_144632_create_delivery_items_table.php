<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_items', function (Blueprint $table) {
            $table->id();

            $table->foreignId('delivery_id')
                ->constrained('deliveries')
                ->cascadeOnDelete();

            $table->string('item_name');
            $table->text('description')->nullable();

            $table->unsignedInteger('quantity')->default(1);

            $table->decimal('weight', 10, 2)->nullable();

            $table->decimal('value', 12, 2)->nullable();

            $table->enum('package_type', [
                'envelope',
                'box',
                'bag',
                'parcel',
                'other',
            ])->default('parcel');

            $table->boolean('is_fragile')->default(false);

            $table->text('notes')->nullable();

            $table->timestamps();

            $table->index('delivery_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_items');
    }
};