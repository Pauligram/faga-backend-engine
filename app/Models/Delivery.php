<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Delivery extends Model
{
    // This removes the security shield and explicitly allows the server to insert these data fields
    protected $fillable = [
        'user_id',
        'status',
        'pickup_address',
        'delivery_address',
        'payment_reference',
        'payment_status',
    ];
}
