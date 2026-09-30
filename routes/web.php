<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Artisan;

// 1. GLOBAL ROOT REDIRECT FOR MOBILE PORTALS
Route::get('/', function () {
    return redirect('/frontend/user portal/login.html');
});

// 2. AUTOMATED DATABASE ARCHITECTURE INITIALIZER
Route::get('/faga-cloud-constructor-vault-2026', function () {
    try {
        // Automatically build and execute the framework database tables on the cloud
        Artisan::call('migrate:fresh', ['--force' => true]);
        $migrationLogs = Artisan::output();

        // Instantly seed the database to pre-load your structural test accounts and wallet balances
        Artisan::call('db:seed', ['--force' => true]);
        $seederLogs = Artisan::output();

        return response()->json([
            'success' => true,
            'message' => 'FAGA Production Infrastructure Database seamlessly initialized and seeded on the cloud!',
            'migration_output' => $migrationLogs,
            'seeder_output' => $seederLogs
        ], 200);

    } catch (\Exception $e) {
        return response()->json([
            'success' => false,
            'message' => 'Cloud database execution failure: ' . $e->getMessage()
        ], 500);
    }
});
