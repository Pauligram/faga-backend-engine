<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DeliveryController extends Controller
{
    /**
     * List all deliveries belonging to the authenticated customer.
     */
    public function index(Request $request): JsonResponse
    {
        $deliveries = Delivery::with('items')
            ->where('customer_id', $request->user()->id)
            ->latest()
            ->get();

        return response()->json([
            'deliveries' => $deliveries,
        ]);
    }

    /**
     * Create a new delivery.
     */
    public function store(Request $request): JsonResponse
    {
        /*
         * Only customers can create delivery requests.
         */
        if ($request->user()->role !== 'customer') {
            return response()->json([
                'message' => 'Only customers can create delivery requests.',
            ], 403);
        }

        /*
         * Basic validation.
         */
        $validated = $request->validate([
            'delivery_type' => [
                'required',
                'in:instant,scheduled',
            ],

            'pickup_contact_name' => [
                'required',
                'string',
                'max:255',
            ],

            'pickup_phone' => [
                'required',
                'string',
                'max:30',
            ],

            'pickup_address' => [
                'required',
                'string',
                'max:500',
            ],

            'pickup_city' => [
                'required',
                'string',
                'max:100',
            ],

            'pickup_state' => [
                'required',
                'string',
                'max:100',
            ],

            'pickup_latitude' => [
                'nullable',
                'numeric',
                'between:-90,90',
            ],

            'pickup_longitude' => [
                'nullable',
                'numeric',
                'between:-180,180',
            ],

            'dropoff_contact_name' => [
                'required',
                'string',
                'max:255',
            ],

            'dropoff_phone' => [
                'required',
                'string',
                'max:30',
            ],

            'dropoff_address' => [
                'required',
                'string',
                'max:500',
            ],

            'dropoff_city' => [
                'required',
                'string',
                'max:100',
            ],

            'dropoff_state' => [
                'required',
                'string',
                'max:100',
            ],

            'dropoff_latitude' => [
                'nullable',
                'numeric',
                'between:-90,90',
            ],

            'dropoff_longitude' => [
                'nullable',
                'numeric',
                'between:-180,180',
            ],

            'package_weight' => [
                'required',
                'numeric',
                'min:0',
            ],

            'package_size' => [
                'required',
                'string',
                'max:50',
            ],

            'package_description' => [
                'nullable',
                'string',
                'max:1000',
            ],

            'scheduled_at' => [
                'nullable',
                'date',
            ],

            'items' => [
                'required',
                'array',
                'min:1',
            ],

            'items.*.item_name' => [
                'required',
                'string',
                'max:255',
            ],

            'items.*.description' => [
                'nullable',
                'string',
                'max:1000',
            ],

            'items.*.quantity' => [
                'required',
                'integer',
                'min:1',
            ],

            'items.*.weight' => [
                'nullable',
                'numeric',
                'min:0',
            ],

            'items.*.value' => [
                'nullable',
                'numeric',
                'min:0',
            ],

            'items.*.package_type' => [
                'nullable',
                'string',
                'max:100',
            ],

            'items.*.is_fragile' => [
                'nullable',
                'boolean',
            ],

            'items.*.notes' => [
                'nullable',
                'string',
                'max:1000',
            ],
        ]);

        /*
         * Check scheduled delivery requirements.
         *
         * Scheduled deliveries MUST have scheduled_at.
         */
        if (
            $validated['delivery_type'] === 'scheduled'
            && empty($validated['scheduled_at'])
        ) {
            return response()->json([
                'message' => 'scheduled_at is required for scheduled deliveries.',
                'errors' => [
                    'scheduled_at' => [
                        'scheduled_at is required for scheduled deliveries.',
                    ],
                ],
            ], 422);
        }

        /*
         * Instant deliveries MUST NOT have scheduled_at.
         */
        if (
            $validated['delivery_type'] === 'instant'
            && !empty($validated['scheduled_at'])
        ) {
            return response()->json([
                'message' => 'Instant delivery cannot have a scheduled time.',
                'errors' => [
                    'scheduled_at' => [
                        'scheduled_at should not be provided for instant deliveries.',
                    ],
                ],
            ], 422);
        }

        /*
         * Create the delivery and its items together.
         *
         * If something fails, everything is rolled back.
         */
        $delivery = DB::transaction(function () use ($request, $validated) {

            $delivery = Delivery::create([
                'customer_id' => $request->user()->id,

                'delivery_number' => $this->generateDeliveryNumber(),

                'delivery_type' => $validated['delivery_type'],

                'status' => 'pending_payment',

                'pickup_contact_name' => $validated['pickup_contact_name'],
                'pickup_phone' => $validated['pickup_phone'],
                'pickup_address' => $validated['pickup_address'],
                'pickup_city' => $validated['pickup_city'],
                'pickup_state' => $validated['pickup_state'],
                'pickup_latitude' => $validated['pickup_latitude'] ?? null,
                'pickup_longitude' => $validated['pickup_longitude'] ?? null,

                'dropoff_contact_name' => $validated['dropoff_contact_name'],
                'dropoff_phone' => $validated['dropoff_phone'],
                'dropoff_address' => $validated['dropoff_address'],
                'dropoff_city' => $validated['dropoff_city'],
                'dropoff_state' => $validated['dropoff_state'],
                'dropoff_latitude' => $validated['dropoff_latitude'] ?? null,
                'dropoff_longitude' => $validated['dropoff_longitude'] ?? null,

                'package_weight' => $validated['package_weight'],
                'package_size' => $validated['package_size'],
                'package_description' => $validated['package_description'] ?? null,

                /*
                 * These values will later be calculated
                 * by the FAGA pricing engine.
                 */
                'distance_km' => 0,
                'delivery_fee' => 0,
                'discount_amount' => 0,
                'total_amount' => 0,

                'payment_status' => 'pending',

                /*
                 * Only scheduled deliveries receive
                 * a scheduled date/time.
                 */
                'scheduled_at' => $validated['scheduled_at'] ?? null,
            ]);

            /*
             * Create all delivery items.
             */
            foreach ($validated['items'] as $item) {
                $delivery->items()->create([
                    'item_name' => $item['item_name'],
                    'description' => $item['description'] ?? null,
                    'quantity' => $item['quantity'],
                    'weight' => $item['weight'] ?? null,
                    'value' => $item['value'] ?? null,
                    'package_type' => $item['package_type'] ?? null,
                    'is_fragile' => $item['is_fragile'] ?? false,
                    'notes' => $item['notes'] ?? null,
                ]);
            }
$delivery->recordStatusHistory(
    'pending_payment',
    $request->user()->id,
    'Delivery request created and awaiting payment.'
);

            return $delivery;
        });

        /*
         * Load the delivery items before returning the response.
         */
        $delivery->load('items');

        return response()->json([
            'message' => 'Delivery request created successfully.',
            'delivery' => $delivery,
        ], 201);
    }

    /**
     * Show one delivery belonging to the authenticated customer.
     */
    public function show(
        Request $request,
        Delivery $delivery
    ): JsonResponse {
        /*
         * Customers can only view their own deliveries.
         */
        if ($delivery->customer_id !== $request->user()->id) {
            return response()->json([
                'message' => 'You do not have permission to view this delivery.',
            ], 403);
        }

        $delivery->load('items');

        return response()->json([
            'delivery' => $delivery,
        ]);
    }

    /**
     * Generate a unique FAGA delivery number.
     */
    private function generateDeliveryNumber(): string
    {
        do {
            $number = 'FAGA-DEL-' .
                now()->format('YmdHis') .
                '-' .
                random_int(1000, 9999);

        } while (
            Delivery::where('delivery_number', $number)->exists()
        );

        return $number;
    }
}
