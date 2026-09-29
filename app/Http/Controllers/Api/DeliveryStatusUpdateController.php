<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DeliveryStatusUpdateController extends Controller
{
    /**
     * Update the status of a delivery.
     */
    public function update(
        Request $request,
        Delivery $delivery
    ): JsonResponse {
        /*
        |--------------------------------------------------------------------------
        | Only admins, dispatchers and riders can update delivery status.
        |--------------------------------------------------------------------------
        */
        $user = $request->user();

        if (!in_array($user->role, [
            'admin',
            'super_admin',
            'dispatcher',
            'rider',
        ], true)) {
            return response()->json([
                'message' => 'You are not authorized to update this delivery.',
            ], 403);
        }

        /*
        |--------------------------------------------------------------------------
        | Validate the new status.
        |--------------------------------------------------------------------------
        */
        $validated = $request->validate([
            'status' => [
                'required',
                'string',
                'in:pending_payment,confirmed,searching_for_rider,rider_assigned,rider_en_route_to_pickup,arrived_at_pickup,picked_up,in_transit,arrived_at_dropoff,delivered,cancelled,failed',
            ],

            'note' => [
                'nullable',
                'string',
                'max:1000',
            ],
        ]);

        /*
        |--------------------------------------------------------------------------
        | Prevent updating a completed delivery.
        |--------------------------------------------------------------------------
        */
        if (in_array($delivery->status, [
            'delivered',
            'cancelled',
            'failed',
        ], true)) {
            return response()->json([
                'message' => 'This delivery can no longer be updated.',
            ], 422);
        }

        /*
        |--------------------------------------------------------------------------
        | Save the new status and create history.
        |--------------------------------------------------------------------------
        */
        DB::transaction(function () use (
            $delivery,
            $validated,
            $user
        ) {
            $delivery->update([
                'status' => $validated['status'],
            ]);

            $delivery->recordStatusHistory(
                $validated['status'],
                $user->id,
                $validated['note'] ?? null
            );

            /*
            |--------------------------------------------------------------------------
            | Record delivery time when delivered.
            |--------------------------------------------------------------------------
            */
            if ($validated['status'] === 'delivered') {
                $delivery->update([
                    'delivered_at' => now(),
                ]);
            }

            /*
            |--------------------------------------------------------------------------
            | Record cancellation time when cancelled.
            |--------------------------------------------------------------------------
            */
            if ($validated['status'] === 'cancelled') {
                $delivery->update([
                    'cancelled_at' => now(),
                    'cancellation_reason' => $validated['note'] ?? null,
                ]);
            }
        });

        /*
        |--------------------------------------------------------------------------
        | Return the updated delivery with its status history.
        |--------------------------------------------------------------------------
        */
        $delivery->load([
            'items',
            'statusHistories',
        ]);

        return response()->json([
            'message' => 'Delivery status updated successfully.',
            'delivery' => $delivery,
        ]);
    }
}