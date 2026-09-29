<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RiderProfile extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'phone',
        'avatar',
        'date_of_birth',
        'gender',
        'address',
        'emergency_contact_name',
        'emergency_contact_phone',
        'verification_status',
        'availability_status',
    ];

    protected $casts = [
        'date_of_birth' => 'date',
    ];

    /**
     * Get the user that owns the rider profile.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the documents belonging to the rider.
     */
    public function documents(): HasMany
    {
        return $this->hasMany(RiderDocument::class);
    }
/**
 * Get the vehicles belonging to the rider.
 */
public function vehicles(): HasMany
{
    return $this->hasMany(Vehicle::class);
}
}