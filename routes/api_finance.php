<?php
declare(strict_types=1);

use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\WalletController;
use Illuminate\Support\Facades\Route;

Route::post(
    '/payments/webhooks/paystack',
    [PaymentController::class, 'webhook']
)->middleware('throttle:120,1');

Route::middleware(['auth:sanctum', 'throttle:60,1'])
    ->group(function (): void {
        Route::get(
            '/payments',
            [PaymentController::class, 'history']
        );

        Route::post(
            '/payments/{reference}/verify',
            [PaymentController::class, 'verify']
        )->where('reference', '[A-Za-z0-9\-]+');

        Route::get(
            '/wallet',
            [WalletController::class, 'show']
        );

        Route::get(
            '/wallet/transactions',
            [WalletController::class, 'transactions']
        );

        Route::get(
            '/wallet/withdrawals',
            [WalletController::class, 'withdrawals']
        );

        Route::post(
            '/wallet/withdrawals',
            [WalletController::class, 'withdraw']
        )->middleware('throttle:5,1');
    });
