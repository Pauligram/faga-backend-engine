<?php

// ==========================================================
// AUTO-RUN MIGRATION & SEEDER BYPASS FOR RENDER FREE PLAN
// ==========================================================
try {
    if (file_exists(__DIR__ . '/../bootstrap/app.php')) {
        $app = require_once __DIR__ . '/../bootstrap/app.php';
        $kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
        
        // Check if our deliveries table exists yet. If not, trigger setup automatically!
        if (!Illuminate\Support\Facades\Schema::hasTable('deliveries')) {
            Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]);
            Illuminate\Support\Facades\Artisan::call('db:seed', ['--force' => true]);
        }
    }
} catch (\Exception $e) {
    // Fails silently if already initialized to keep application processing fast
}

// ... rest of your original index.php code remains exactly the same below ...


use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require __DIR__.'/../vendor/autoload.php';

// Bootstrap Laravel and handle the request...
/** @var Application $app */
$app = require_once __DIR__.'/../bootstrap/app.php';

$app->handleRequest(Request::capture());
