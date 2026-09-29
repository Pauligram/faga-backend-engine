<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SellerApplication;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminSellerApplicationController extends Controller
{
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

    public function index(Request $request): JsonResponse
    {
        if ($response = $this->ensureAdmin($request)) {
            return $response;
        }

        $applications = SellerApplication::with('user')
            ->latest()
            ->get();

        return response()->json([
            'applications' => $applications,
        ]);
    }

    public function show(
        Request $request,
        SellerApplication $sellerApplication
    ): JsonResponse {
        if ($response = $this->ensureAdmin($request)) {
            return $response;
        }

        $sellerApplication->load('user');

        return response()->json([
            'application' => $sellerApplication,
        ]);
    }

    public function review(
        Request $request,
        SellerApplication $sellerApplication
    ): JsonResponse {
        if ($response = $this->ensureAdmin($request)) {
            return $response;
        }

        if ($sellerApplication->application_status !== 'pending') {
            return response()->json([
                'message' => 'Only pending applications can be moved under review.',
            ], 422);
        }

        $sellerApplication->update([
            'application_status' => 'under_review',
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        return response()->json([
            'message' => 'Seller application is now under review.',
            'application' => $sellerApplication->fresh(),
        ]);
    }

    public function approve(
        Request $request,
        SellerApplication $sellerApplication
    ): JsonResponse {
        if ($response = $this->ensureAdmin($request)) {
            return $response;
        }

        if (! in_array(
            $sellerApplication->application_status,
            ['pending', 'under_review'],
            true
        )) {
            return response()->json([
                'message' => 'This application cannot be approved.',
            ], 422);
        }

        $user = $sellerApplication->user;

        DB::transaction(function () use (
            $request,
            $sellerApplication,
            $user
        ) {
            $sellerProfile = $user->sellerProfile()->firstOrCreate(
                [],
                [
                    'business_name' => $sellerApplication->business_name,
                    'business_email' => $sellerApplication->business_email,
                    'business_phone' => $sellerApplication->business_phone,
                    'business_address' => $sellerApplication->business_address,
                    'city' => $sellerApplication->city,
                    'state' => $sellerApplication->state,
                    'country' => $sellerApplication->country ?? 'Nigeria',
                    'business_registration_number' =>
                        $sellerApplication->business_registration_number,
                    'tax_identification_number' =>
                        $sellerApplication->tax_identification_number,
                    'verification_status' => 'pending',
                    'is_active' => true,
                ]
            );

            $sellerProfile->update([
                'business_name' => $sellerApplication->business_name,
                'business_email' => $sellerApplication->business_email,
                'business_phone' => $sellerApplication->business_phone,
                'business_address' => $sellerApplication->business_address,
                'city' => $sellerApplication->city,
                'state' => $sellerApplication->state,
                'country' => $sellerApplication->country ?? 'Nigeria',
                'business_registration_number' =>
                    $sellerApplication->business_registration_number,
                'tax_identification_number' =>
                    $sellerApplication->tax_identification_number,
            ]);

            $user->roles()->firstOrCreate([
                'role' => 'seller',
            ]);

            $user->update([
                'role' => 'seller',
            ]);

            $sellerApplication->update([
                'application_status' => 'approved',
                'reviewed_by' => $request->user()->id,
                'reviewed_at' => now(),
                'rejection_reason' => null,
            ]);
        });

        return response()->json([
            'message' => 'Seller application approved successfully.',
            'application' => $sellerApplication->fresh(),
            'user' => $user->fresh()->load(
                'roles',
                'sellerProfile'
            ),
        ]);
    }

    public function reject(
        Request $request,
        SellerApplication $sellerApplication
    ): JsonResponse {
        if ($response = $this->ensureAdmin($request)) {
            return $response;
        }

        if (! in_array(
            $sellerApplication->application_status,
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

        $sellerApplication->update([
            'application_status' => 'rejected',
            'rejection_reason' => $validated['rejection_reason'],
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        return response()->json([
            'message' => 'Seller application rejected.',
            'application' => $sellerApplication->fresh(),
        ]);
    }
}