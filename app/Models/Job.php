<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Job extends Model
{
    use HasFactory;

    // Laravel uses `jobs` for its queue; employment listings use `job_postings`.
    protected $table = 'job_postings';

    protected $fillable = [
        'posted_by',
        'title',
        'company_name',
        'description',
        'category',
        'employment_type',
        'location',
        'state',
        'country',
        'salary_min',
        'salary_max',
        'salary_period',
        'requirements',
        'responsibilities',
        'application_deadline',
        'status',
        'contact_email',
        'contact_phone',
    ];

    protected $casts = [
        'salary_min' => 'decimal:2',
        'salary_max' => 'decimal:2',
        'application_deadline' => 'date',
    ];

    /**
     * User who posted the job.
     */
    public function postedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'posted_by');
    }

    /**
     * Applications submitted for this job.
     */
    public function applications(): HasMany
    {
        return $this->hasMany(JobApplication::class);
    }
}