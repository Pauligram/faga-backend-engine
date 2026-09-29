<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Vehicle extends Model
{
    use HasFactory;

    protected $fillable = [
        'rider_profile_id',
        'vehicle_type',
        'make',
        'model',
        'year',
        'color',
        'plate_number',
        'registration_number',
        'registration_expiry',
        'verification_status',
        'rejection_reason',
        'is_active',
    ];

    protected $casts = [
        'registration_expiry' => 'date',
        'is_active' => 'boolean',
    ];

    /**
     * Get the rider profile that owns this vehicle.
     */
    public function riderProfile(): BelongsTo
    {
        return $this->belongsTo(RiderProfile::class);
    }
}