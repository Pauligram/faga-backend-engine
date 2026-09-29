<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DeliveryAssignmentController extends Controller
{
    /**
     * Assign a rider to a delivery.
     */
    public function assign(
        Request $request,
        Delivery $delivery
    ): JsonResponse {
        $user = $request->user();

        /*
        |--------------------------------------------------------------------------
        | Only admins and dispatchers can assign riders.
        |--------------------------------------------------------------------------
        */

        if (!in_array($user->role, [
            'admin',
            'super_admin',
            'dispatcher',
        ], true)) {
            return response()->json([
                'message' => 'You are not authorized to assign a rider.',
            ], 403);
        }

        /*
        |--------------------------------------------------------------------------
        | Validate rider ID.
        |--------------------------------------------------------------------------
        */

        $validated = $request->validate([
            'rider_id' => [
                'required',
                'integer',
                'exists:users,id',
            ],
        ]);

        /*
        |--------------------------------------------------------------------------
        | Find the rider.
        |--------------------------------------------------------------------------
        */

        $rider = User::where('id', $validated['rider_id'])
            ->where('role', 'rider')
            ->where('is_active', true)
            ->first();

        if (!$rider) {
            return response()->json([
                'message' => 'The selected rider is not available.',
            ], 422);
        }

        /*
        |--------------------------------------------------------------------------
        | Prevent assigning a completed delivery.
        |--------------------------------------------------------------------------
        */

        if (in_array($delivery->status, [
            'delivered',
            'cancelled',
            'failed',
        ], true)) {
            return response()->json([
                'message' => 'This delivery can no longer be assigned.',
            ], 422);
        }

        /*
        |--------------------------------------------------------------------------
        | Assign the rider.
        |--------------------------------------------------------------------------
        */

        DB::transaction(function () use (
            $delivery,
            $rider,
            $user
        ) {
            $delivery->update([
                'rider_id' => $rider->id,
                'status' => 'rider_assigned',
            ]);

            $delivery->recordStatusHistory(
                'rider_assigned',
                $user->id,
                'Rider assigned to delivery.'
            );
        });

        /*
        |--------------------------------------------------------------------------
        | Load related information.
        |--------------------------------------------------------------------------
        */

        $delivery->load([
            'items',
            'statusHistories',
            'rider',
        ]);

        return response()->json([
            'message' => 'Rider assigned successfully.',
            'delivery' => $delivery,
        ]);
    }
}