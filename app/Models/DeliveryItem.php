<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeliveryItem extends Model
{
    use HasFactory;

    protected $fillable = [
        'delivery_id',
        'item_name',
        'description',
        'quantity',
        'weight',
        'value',
        'package_type',
        'is_fragile',
        'notes',
    ];

    protected $casts = [
        'quantity' => 'integer',
        'weight' => 'decimal:2',
        'value' => 'decimal:2',
        'is_fragile' => 'boolean',
    ];

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }
}