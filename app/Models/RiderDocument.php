<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RiderDocument extends Model
{
    // These are the records we need to keep track of for every uploaded document
    protected $fillable = [
        'rider_profile_id',
        'document_type', // 'DRIVERS_LICENSE', 'VEHICLE_REGISTRATION', 'INSURANCE'
        'file_path',      // The secret address inside the private vault room
        'status',         // 'PENDING', 'APPROVED', 'REJECTED'
    ];
}
