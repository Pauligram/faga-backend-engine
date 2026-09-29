<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Dispute extends Model
{
    protected $fillable = [
        'user_id',
        'ride_id',
        'reason',
        'description',
        'status',
        'resolution_action',
        'admin_notes'
    ];
}
