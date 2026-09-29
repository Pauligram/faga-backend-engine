<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use App\Services\Finance\WalletService;

class PaymentWebhookController extends Controller
{
    /**
     * Handle incoming notification receipts from Paystack.
     */
    public function handlePaystack(Request $request): JsonResponse
    {
        // 1. SECURITY CHECK: Grab the cryptographic lock signature sent by Paystack
        $paystackSignature = $request->header('x-paystack-signature');
        $secretKey = config('services.paystack.secret_key');

        // Calculate our own hash key signature to double check they match exactly
        $calculatedSignature = hash_hmac('sha512', $request->getContent(), $secretKey);

        if ($paystackSignature !== $calculatedSignature) {
            Log::warning('FAGA Security Alert: Blocked unauthorized payload attempt on Paystack endpoint.');
            return response()->json(['message' => 'Unauthorized Signature Hash'], 401);
        }

        // 2. Read the electronic receipt content data
        $payload = $request->all();
        
        // We only care about events where a charge was successful
        if (isset($payload['event']) && $payload['event'] === 'charge.success') {
            $transactionData = $payload['data'];
            $referenceCode   = $transactionData['reference'];
            $amountInKobo    = $transactionData['amount']; 
            $amountInNaira   = $amountInKobo / 100; // Paystack works in kobo, convert it back to full units

            Log::info("Paystack payment confirmed successful for Reference: {$referenceCode}, Amount: ₦{$amountInNaira}");

            // 3. DATABASE ACTION: Look inside your transactions table to find matching payment details
            // For example, finding a delivery tracking match and updating payment status to 'PAID'
            DB::table('deliveries')
                ->where('payment_reference', $referenceCode)
                ->update([
                    'payment_status' => 'PAID',
                    'updated_at' => now()
                ]);

            // Optional: If it matches a ride table payment reference
            DB::table('rides')
                ->where('payment_reference', $referenceCode)
                ->update([
                    'payment_status' => 'PAID',
                    'updated_at' => now()
                ]);

            return response()->json(['status' => 'success', 'message' => 'Payment cataloged successfully.'], 200);
        }

        // Return a standard acknowledgment for other event notifications we don't handle
        return response()->json(['status' => 'ignored'], 200);
    }
}
