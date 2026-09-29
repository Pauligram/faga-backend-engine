<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SellerApplication extends Model
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
        'application_status',
        'rejection_reason',
        'reviewed_by',
        'reviewed_at',
    ];

    protected $casts = [
        'reviewed_at' => 'datetime',
    ];

    /**
     * The user who submitted this application.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The administrator who reviewed this application.
     */
    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }
}