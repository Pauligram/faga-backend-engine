<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'password', 'role', 'is_active'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    /** @use HasFactory<UserFactory> */
    protected static function newFactory()
    {
        return UserFactory::new();
    }

    /**
     * Get the customer's profile.
     */
    public function customerProfile(): HasOne
    {
        return $this->hasOne(CustomerProfile::class);
    }

    /**
     * Get the rider's profile.
     */
    public function riderProfile(): HasOne
    {
        return $this->hasOne(RiderProfile::class);
    }

    /**
     * Get the admin's profile.
     */
    public function adminProfile(): HasOne
    {
        return $this->hasOne(AdminProfile::class);
    }

    public function sellerProfile(): HasOne
{
    return $this->hasOne(SellerProfile::class);
}

    /**
     * Get the user's addresses.
     */
    public function addresses(): HasMany
    {
        return $this->hasMany(Address::class);
    }

public function deliveries(): HasMany
{
    return $this->hasMany(Delivery::class, 'customer_id');
}

    public function roles(): HasMany
{
    return $this->hasMany(UserRole::class);
}

public function riderApplications(): HasMany
{
    return $this->hasMany(RiderApplication::class);
}
public function sellerApplications(): HasMany
{
    return $this->hasMany(SellerApplication::class);
}

public function hasRole(string $role): bool
{
    return $this->roles()
        ->where('role', $role)
        ->exists();
}

public function hasAnyRole(array $roles): bool
{
    return $this->roles()
        ->whereIn('role', $roles)
        ->exists();
}

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
        ];
    }
}