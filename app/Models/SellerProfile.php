<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SellerProfile extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'business_name',
        'business_email',
        'business_phone',
        'business_address',
        'city',
        'state',
        'country',
        'business_registration_number',
        'tax_identification_number',
        'logo',
        'cover_image',
        'verification_status',
        'rejection_reason',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    /**
     * The user who owns this seller profile.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}