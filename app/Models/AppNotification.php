<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AppNotification extends Model
{
    // Make your system database connection model open to mapping these properties
    protected $table = 'app_notifications';
    
    protected $fillable = [
        'user_id',
        'title',
        'message',
        'is_read'
    ];
}
