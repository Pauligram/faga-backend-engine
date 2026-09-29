<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SellerApplicationController extends Controller
{
    /**
     * Submit a new seller application.
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        // Prevent duplicate active applications.
        $existingApplication = $user->sellerApplications()
            ->whereIn('application_status', [
                'pending',
                'under_review',
            ])
            ->exists();

        if ($existingApplication) {
            return response()->json([
                'message' => 'You already have an active seller application.',
            ], 422);
        }

        // Prevent an existing seller from applying again.
        if ($user->hasRole('seller')) {
            return response()->json([
                'message' => 'You are already registered as a seller.',
            ], 422);
        }

        $validated = $request->validate([
            'business_name' => [
                'required',
                'string',
                'max:255',
            ],
            'business_email' => [
                'nullable',
                'email',
                'max:255',
            ],
            'business_phone' => [
                'required',
                'string',
                'max:30',
            ],
            'business_address' => [
                'nullable',
                'string',
            ],
            'city' => [
                'nullable',
                'string',
                'max:100',
            ],
            'state' => [
                'nullable',
                'string',
                'max:100',
            ],
            'country' => [
                'nullable',
                'string',
                'max:100',
            ],
            'business_registration_number' => [
                'nullable',
                'string',
                'max:100',
            ],
            'tax_identification_number' => [
                'nullable',
                'string',
                'max:100',
            ],
        ]);

        $application = $user->sellerApplications()->create([
            ...$validated,
            'application_status' => 'pending',
        ]);

        return response()->json([
            'message' => 'Seller application submitted successfully.',
            'application' => $application,
        ], 201);
    }

    /**
     * View the authenticated user's latest seller application.
     */
    public function show(Request $request): JsonResponse
    {
        $application = $request->user()
            ->sellerApplications()
            ->latest()
            ->first();

        if (! $application) {
            return response()->json([
                'message' => 'No seller application found.',
            ], 404);
        }

        return response()->json([
            'application' => $application,
        ]);
    }
}