<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class JobSubscription extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'plan',
        'amount',
        'starts_at',
        'expires_at',
        'status',
        'payment_reference',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'starts_at' => 'datetime',
        'expires_at' => 'datetime',
    ];

    /**
     * User who owns the subscription.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Determine whether the subscription is currently active.
     */
    public function isActive(): bool
    {
        return $this->status === 'active'
            && $this->expires_at !== null
            && $this->expires_at->isFuture();
    }
}