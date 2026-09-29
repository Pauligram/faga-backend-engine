<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Address;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AddressController extends Controller
{
    /**
     * List all addresses belonging to the authenticated user.
     */
    public function index(Request $request)
    {
        $addresses = $request->user()
            ->addresses()
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->get();

        return response()->json([
            'message' => 'Addresses retrieved successfully.',
            'addresses' => $addresses,
        ]);
    }

    /**
     * Create a new address.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'label' => [
                'required',
                'string',
                'max:100',
            ],

            'recipient_name' => [
                'required',
                'string',
                'max:255',
            ],

            'phone' => [
                'required',
                'string',
                'max:30',
            ],

            'address_line' => [
                'required',
                'string',
                'max:500',
            ],

            'landmark' => [
                'nullable',
                'string',
                'max:255',
            ],

            'city' => [
                'required',
                'string',
                'max:100',
            ],

            'state' => [
                'required',
                'string',
                'max:100',
            ],

            'country' => [
                'required',
                'string',
                'max:100',
            ],

            'postal_code' => [
                'nullable',
                'string',
                'max:30',
            ],

            'latitude' => [
                'nullable',
                'numeric',
                'between:-90,90',
            ],

            'longitude' => [
                'nullable',
                'numeric',
                'between:-180,180',
            ],

            'is_default' => [
                'sometimes',
                'boolean',
            ],
        ]);

        $user = $request->user();

        $address = DB::transaction(function () use ($user, $validated) {

            $isDefault = $validated['is_default'] ?? false;

            if ($isDefault) {
                $user->addresses()->update([
                    'is_default' => false,
                ]);
            }

            /*
             * If this is the user's first address,
             * automatically make it the default address.
             */
            if ($user->addresses()->count() === 0) {
                $isDefault = true;
            }

            $validated['is_default'] = $isDefault;

            return $user->addresses()->create($validated);
        });

        return response()->json([
            'message' => 'Address created successfully.',
            'address' => $address,
        ], 201);
    }

    /**
     * View one address belonging to the authenticated user.
     */
    public function show(Request $request, Address $address)
    {
        $this->authorizeAddress($request, $address);

        return response()->json([
            'message' => 'Address retrieved successfully.',
            'address' => $address,
        ]);
    }

    /**
     * Update an address.
     */
    public function update(Request $request, Address $address)
    {
        $this->authorizeAddress($request, $address);

        $validated = $request->validate([
            'label' => [
                'sometimes',
                'string',
                'max:100',
            ],

            'recipient_name' => [
                'sometimes',
                'string',
                'max:255',
            ],

            'phone' => [
                'sometimes',
                'string',
                'max:30',
            ],

            'address_line' => [
                'sometimes',
                'string',
                'max:500',
            ],

            'landmark' => [
                'nullable',
                'string',
                'max:255',
            ],

            'city' => [
                'sometimes',
                'string',
                'max:100',
            ],

            'state' => [
                'sometimes',
                'string',
                'max:100',
            ],

            'country' => [
                'sometimes',
                'string',
                'max:100',
            ],

            'postal_code' => [
                'nullable',
                'string',
                'max:30',
            ],

            'latitude' => [
                'nullable',
                'numeric',
                'between:-90,90',
            ],

            'longitude' => [
                'nullable',
                'numeric',
                'between:-180,180',
            ],

            'is_default' => [
                'sometimes',
                'boolean',
            ],
        ]);

        DB::transaction(function () use ($request, $address, $validated) {

            if (
                array_key_exists('is_default', $validated)
                && $validated['is_default'] === true
            ) {
                $request->user()
                    ->addresses()
                    ->whereKeyNot($address->id)
                    ->update([
                        'is_default' => false,
                    ]);
            }

            $address->update($validated);
        });

        return response()->json([
            'message' => 'Address updated successfully.',
            'address' => $address->fresh(),
        ]);
    }

    /**
     * Delete an address.
     */
    public function destroy(Request $request, Address $address)
    {
        $this->authorizeAddress($request, $address);

        $wasDefault = $address->is_default;

        $address->delete();

        /*
         * If the deleted address was the default address,
         * make another address the default.
         */
        if ($wasDefault) {
            $nextAddress = $request->user()
                ->addresses()
                ->orderBy('id')
                ->first();

            if ($nextAddress) {
                $nextAddress->update([
                    'is_default' => true,
                ]);
            }
        }

        return response()->json([
            'message' => 'Address deleted successfully.',
        ]);
    }

    /**
     * Set an address as the default address.
     */
    public function setDefault(Request $request, Address $address)
    {
        $this->authorizeAddress($request, $address);

        DB::transaction(function () use ($request, $address) {

            $request->user()
                ->addresses()
                ->update([
                    'is_default' => false,
                ]);

            $address->update([
                'is_default' => true,
            ]);
        });

        return response()->json([
            'message' => 'Default address updated successfully.',
            'address' => $address->fresh(),
        ]);
    }

    /**
     * Ensure the address belongs to the authenticated user.
     */
    private function authorizeAddress(
        Request $request,
        Address $address
    ): void {
        abort_unless(
            $address->user_id === $request->user()->id,
            403,
            'You are not authorized to access this address.'
        );
    }
}