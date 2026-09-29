<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CustomerProfileController extends Controller
{
    /**
     * Get the authenticated customer's profile.
     */
    public function show(Request $request)
    {
        $user = $request->user();

        $profile = $user->customerProfile()->firstOrCreate(
            ['user_id' => $user->id],
            []
        );

        return response()->json([
            'message' => 'Customer profile retrieved successfully.',
            'user' => $user,
            'profile' => $profile,
        ]);
    }

    /**
     * Update the authenticated customer's profile.
     */
    public function update(Request $request)
    {
        $user = $request->user();

        $validated = $request->validate([
            'name' => [
                'sometimes',
                'string',
                'max:255',
            ],

            'email' => [
                'sometimes',
                'email',
                'max:255',
                Rule::unique('users', 'email')->ignore($user->id),
            ],

            'phone' => [
                'nullable',
                'string',
                'max:30',
            ],

            'avatar' => [
                'nullable',
                'string',
                'max:500',
            ],

            'date_of_birth' => [
                'nullable',
                'date',
            ],

            'gender' => [
                'nullable',
                Rule::in([
                    'male',
                    'female',
                    'other',
                ]),
            ],

            'bio' => [
                'nullable',
                'string',
                'max:1000',
            ],
        ]);

        $userData = [];

        if (array_key_exists('name', $validated)) {
            $userData['name'] = $validated['name'];
        }

        if (array_key_exists('email', $validated)) {
            $userData['email'] = $validated['email'];
        }

        if (!empty($userData)) {
            $user->update($userData);
        }

        $profileData = collect($validated)
            ->except(['name', 'email'])
            ->toArray();

        $profile = $user->customerProfile()->firstOrCreate(
            ['user_id' => $user->id],
            []
        );

        if (!empty($profileData)) {
            $profile->update($profileData);
        }

        return response()->json([
            'message' => 'Customer profile updated successfully.',
            'user' => $user->fresh(),
            'profile' => $profile->fresh(),
        ]);
    }
}