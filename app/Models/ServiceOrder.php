<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ServiceOrder extends Model
{
    protected $fillable = [
        'user_id',
        'order_type',
        'item_or_service_name',
        'total_amount',
        'status',
        'payment_status'
    ];
}
