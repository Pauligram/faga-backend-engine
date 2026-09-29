<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Models\DeliveryStatusHistory;

class DeliveryStatusHistory extends Model
{
    use HasFactory;

    public $timestamps = false;

    protected $fillable = [
        'delivery_id',
        'status',
        'note',
        'changed_by',
        'created_at',
    ];

    protected $casts = [
        'created_at' => 'datetime',
    ];
    
    protected $table = 'delivery_status_histories'; 
    /**
     * The delivery this status history belongs to.
     */
    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }

    /**
     * The user who changed the delivery status.
     */
    public function changedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'changed_by');
    }
}