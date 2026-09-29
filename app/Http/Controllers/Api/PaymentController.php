<?php
declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Finance\PaymentSettlementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

final class PaymentController extends Controller
{
    public function __construct(
        private readonly PaymentSettlementService $settlements
    ) {}

    /**
     * A customer may verify only their own payment.
     * Payment creation is performed by the relevant order or
     * booking service after server-side price calculation.
     */
    public function verify(Request $request, string $reference): JsonResponse
    {
        $user = $request->user();

        $intent = DB::table('payment_intents')
            ->where('provider_reference', $reference)
            ->where('customer_id', $user->id)
            ->first();

        if ($intent === null) {
            return response()->json([
                'message' => 'Payment not found.',
            ], Response::HTTP_NOT_FOUND);
        }

        try {
            $transactionId = $this->settlements
                ->verifyAndSettle($reference);

            return response()->json([
                'message' => 'Payment verified.',
                'transaction_id' => $transactionId,
            ]);
        } catch (Throwable $exception) {
            Log::warning('Payment verification unsuccessful.', [
                'reference' => $reference,
                'exception' => $exception::class,
            ]);

            return response()->json([
                'message' => 'Payment could not be verified.',
            ], Response::HTTP_CONFLICT);
        }
    }

    /**
     * Paystack webhook:
     * - Verify the signature against the raw request body.
     * - Persist a unique event identifier.
     * - Reverify successful payments directly with Paystack.
     * - Permit safe webhook retries.
     */
    public function webhook(Request $request): JsonResponse
    {
        $secret = config('services.paystack.secret_key');

        if (! is_string($secret) || $secret === '') {
            return response()->json([
                'message' => 'Payment provider unavailable.',
            ], Response::HTTP_SERVICE_UNAVAILABLE);
        }

        $body = $request->getContent();
        $signature = $request->header('x-paystack-signature', '');
        $expected = hash_hmac('sha512', $body, $secret);

        if (
            ! is_string($signature) ||
            ! hash_equals($expected, $signature)
        ) {
            return response()->json([
                'message' => 'Invalid webhook signature.',
            ], Response::HTTP_UNAUTHORIZED);
        }

        $event = $request->json()->all();
        $reference = $event['data']['reference'] ?? null;
        $eventType = $event['event'] ?? null;

        if (
            ! is_string($eventType) ||
            ! is_string($reference) ||
            $reference === ''
        ) {
            return response()->json([
                'message' => 'Invalid webhook payload.',
            ], Response::HTTP_UNPROCESSABLE_ENTITY);
        }

        $eventId = hash('sha256', $body);

        DB::table('payment_webhook_events')->insertOrIgnore([
            'provider' => 'paystack',
            'event_id' => $eventId,
            'provider_reference' => $reference,
            'status' => 'received',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        if ($eventType !== 'charge.success') {
            DB::table('payment_webhook_events')
                ->where('provider', 'paystack')
                ->where('event_id', $eventId)
                ->update([
                    'status' => 'ignored',
                    'processed_at' => now(),
                    'updated_at' => now(),
                ]);

            return response()->json(['message' => 'Event acknowledged.']);
        }

        try {
            $this->settlements->verifyAndSettle($reference);

            DB::table('payment_webhook_events')
                ->where('provider', 'paystack')
                ->where('event_id', $eventId)
                ->update([
                    'status' => 'processed',
                    'processed_at' => now(),
                    'updated_at' => now(),
                ]);

            return response()->json([
                'message' => 'Payment settled.',
            ]);
        } catch (Throwable $exception) {
            Log::error('Payment webhook settlement failed.', [
                'reference' => $reference,
                'event_id' => $eventId,
                'exception' => $exception::class,
            ]);

            return response()->json([
                'message' => 'Settlement pending retry.',
            ], Response::HTTP_SERVICE_UNAVAILABLE);
        }
    }

    public function history(Request $request): JsonResponse
    {
        $userId = (int) $request->user()->id;

        $payments = DB::table('payment_intents')
            ->where('customer_id', $userId)
            ->select([
                'id',
                'provider_reference',
                'purpose',
                'currency',
                'amount_minor',
                'status',
                'verified_at',
                'created_at',
            ])
            ->orderByDesc('created_at')
            ->paginate(20);

        return response()->json($payments);
    }
}
