<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\RiderApplication;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RiderApplicationController extends Controller
{
    /**
     * Submit a new rider application.
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        // Prevent duplicate active applications.
        $existingApplication = $user->riderApplications()
            ->whereIn('application_status', [
                'pending',
                'under_review',
            ])
            ->exists();

        if ($existingApplication) {
            return response()->json([
                'message' => 'You already have an active rider application.',
            ], 422);
        }

        // Prevent an existing rider from applying again.
        if ($user->hasRole('rider')) {
            return response()->json([
                'message' => 'You are already registered as a rider.',
            ], 422);
        }

        $validated = $request->validate([
            'full_name' => ['required', 'string', 'max:255'],
            'phone' => ['required', 'string', 'max:30'],
            'date_of_birth' => ['nullable', 'date'],
            'gender' => ['nullable', 'string', 'max:50'],
            'address' => ['nullable', 'string'],
            'emergency_contact_name' => ['nullable', 'string', 'max:255'],
            'emergency_contact_phone' => ['nullable', 'string', 'max:30'],
        ]);

        $application = $user->riderApplications()->create([
            ...$validated,
            'application_status' => 'pending',
        ]);

        return response()->json([
            'message' => 'Rider application submitted successfully.',
            'application' => $application,
        ], 201);
    }

    /**
     * View the authenticated user's latest rider application.
     */
    public function show(Request $request): JsonResponse
    {
        $application = $request->user()
            ->riderApplications()
            ->latest()
            ->first();

        if (! $application) {
            return response()->json([
                'message' => 'No rider application found.',
            ], 404);
        }

        return response()->json([
            'application' => $application,
        ]);
    }
}