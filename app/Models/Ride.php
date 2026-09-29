<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Ride extends Model
{
    // This tells the application it is officially allowed to save these pieces of information into a ride record
    protected $fillable = [
        'user_id',
        'status',
        'pickup_address',
        'dropoff_address',
    ];
}
