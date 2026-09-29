<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Artisan;

// 1. BASE LANDING REDIRECT
Route::get('/', function () {
    return redirect('/frontend/user portal/login.html');
});

// 2. VAULT CONFIGURATION AUTOMATOR: Bypasses the shell block to setup your cloud tables
Route::get('/faga-deploy-system-vault-xyz', function () {
    try {
        // Run the table migrations securely onto your cloud database tower
        Artisan::call('migrate', ['--force' => true]);
        $migrationOutput = Artisan::output();

        // Inject your test customer profiles and their ₦25,000 starting wallet balances
        Artisan::call('db:seed', ['--force' => true]);
        $seederOutput = Artisan::output();

        return response()->json([
            'success' => true,
            'message' => 'FAGA Production Database Cloud Architecture successfully compiled and seeded!',
            'migration_logs' => $migrationOutput,
            'seeder_logs' => $seederOutput
        ], 200);

    } catch (\Exception $e) {
        return response()->json([
            'success' => false,
            'message' => 'Cloud migration error: ' . $e->getMessage()
        ], 500);
    }
});