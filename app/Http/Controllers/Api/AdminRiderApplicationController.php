<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\RiderApplication;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminRiderApplicationController extends Controller
{
    /**
     * Ensure the authenticated user is an administrator.
     */
    private function ensureAdmin(Request $request): ?JsonResponse
    {
        $user = $request->user();

        if (! $user->hasAnyRole(['admin', 'super_admin'])) {
            return response()->json([
                'message' => 'You do not have permission to access this resource.',
            ], 403);
        }

        return null;
    }

    /**
     * List rider applications.
     */
    public function index(Request $request): JsonResponse
    {
        if ($response = $this->ensureAdmin($request)) {
            return $response;
        }

        $applications = RiderApplication::with('user')
            ->latest()
            ->get();

        return response()->json([
            'applications' => $applications,
        ]);
    }

    /**
     * View a single rider application.
     */
    public function show(
        Request $request,
        RiderApplication $riderApplication
    ): JsonResponse {
        if ($response = $this->ensureAdmin($request)) {
            return $response;
        }

        $riderApplication->load('user');

        return response()->json([
            'application' => $riderApplication,
        ]);
    }

    /**
     * Mark an application as under review.
     */
    public function review(
        Request $request,
        RiderApplication $riderApplication
    ): JsonResponse {
        if ($response = $this->ensureAdmin($request)) {
            return $response;
        }

        if ($riderApplication->application_status !== 'pending') {
            return response()->json([
                'message' => 'Only pending applications can be moved under review.',
            ], 422);
        }

        $riderApplication->update([
            'application_status' => 'under_review',
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        return response()->json([
            'message' => 'Rider application is now under review.',
            'application' => $riderApplication->fresh(),
        ]);
    }

    /**
     * Approve a rider application.
     */
    public function approve(
        Request $request,
        RiderApplication $riderApplication
    ): JsonResponse {
        if ($response = $this->ensureAdmin($request)) {
            return $response;
        }

        if (! in_array(
            $riderApplication->application_status,
            ['pending', 'under_review'],
            true
        )) {
            return response()->json([
                'message' => 'This application cannot be approved.',
            ], 422);
        }

        $user = $riderApplication->user;

        DB::transaction(function () use (
            $request,
            $riderApplication,
            $user
        ) {
            $riderProfile = $user->riderProfile()->firstOrCreate(
                [],
                [
                    'phone' => $riderApplication->phone,
                    'date_of_birth' => $riderApplication->date_of_birth,
                    'gender' => $riderApplication->gender,
                    'address' => $riderApplication->address,
                    'emergency_contact_name' =>
                        $riderApplication->emergency_contact_name,
                    'emergency_contact_phone' =>
                        $riderApplication->emergency_contact_phone,
                    'verification_status' => 'pending',
                    'availability_status' => 'offline',
                ]
            );

            $riderProfile->update([
                'phone' => $riderApplication->phone,
                'date_of_birth' => $riderApplication->date_of_birth,
                'gender' => $riderApplication->gender,
                'address' => $riderApplication->address,
                'emergency_contact_name' =>
                    $riderApplication->emergency_contact_name,
                'emergency_contact_phone' =>
                    $riderApplication->emergency_contact_phone,
            ]);

            $user->roles()->firstOrCreate([
                'role' => 'rider',
            ]);

            // Keep the legacy role column synchronized with the
            // user's primary/current operational role.
            $user->update([
                'role' => 'rider',
            ]);

            $riderApplication->update([
                'application_status' => 'approved',
                'reviewed_by' => $request->user()->id,
                'reviewed_at' => now(),
                'rejection_reason' => null,
            ]);
        });

        return response()->json([
            'message' => 'Rider application approved successfully.',
            'application' => $riderApplication->fresh(),
            'user' => $user->fresh()->load(
                'roles',
                'riderProfile'
            ),
        ]);
    }

    /**
     * Reject a rider application.
     */
    public function reject(
        Request $request,
        RiderApplication $riderApplication
    ): JsonResponse {
        if ($response = $this->ensureAdmin($request)) {
            return $response;
        }

        if (! in_array(
            $riderApplication->application_status,
            ['pending', 'under_review'],
            true
        )) {
            return response()->json([
                'message' => 'This application cannot be rejected.',
            ], 422);
        }

        $validated = $request->validate([
            'rejection_reason' => [
                'required',
                'string',
                'max:2000',
            ],
        ]);

        $riderApplication->update([
            'application_status' => 'rejected',
            'rejection_reason' => $validated['rejection_reason'],
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        return response()->json([
            'message' => 'Rider application rejected.',
            'application' => $riderApplication->fresh(),
        ]);
    }
}