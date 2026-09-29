<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MarketplaceOrder extends Model
{
    protected $fillable = [
        'user_id',
        'seller_id',
        'product_name',
        'price',
        'status',
        'payment_status'
    ];
}
