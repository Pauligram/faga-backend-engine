<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

class TelemetryBufferService
{
    /**
     * Store the driver's current coordinates inside a fast temporary cache memory tank.
     */
    public function pushLocation(int $rideId, float $latitude, float $longitude): void
    {
        $cacheKey = "ride_tracking_{$rideId}";
        
        $data = [
            'latitude'  => $latitude,
            'longitude' => $longitude,
            'timestamp' => now()->toIso8601String()
        ];

        // Save inside the quick cache tank for 30 minutes
        Cache::put($cacheKey, $data, now()->addMinutes(30));
    }

    /**
     * Retrieve the latest coordinates for a specific trip.
     */
    public function getLatestLocation(int $rideId): ?array
    {
        $cacheKey = "ride_tracking_{$rideId}";
        return Cache::get($cacheKey);
    }
}
