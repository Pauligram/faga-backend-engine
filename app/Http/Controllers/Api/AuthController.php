<?php
declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

final class AuthController extends Controller
{
    private const TOKEN_NAME = 'faga-api';

    private const MAX_LOGIN_ATTEMPTS = 5;

    private const LOGIN_DECAY_SECONDS = 300;

    private const ALLOWED_REGISTRATION_ROLE = 'customer';

    /**
     * Register a customer.
     *
     * Public registration never accepts a role, account status,
     * permissions or administrator privileges from the client.
     */
    public function register(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => [
                'required',
                'string',
                'min:2',
                'max:255',
            ],
            'email' => [
                'required',
                'string',
                'email',
                'max:255',
                'unique:users,email',
            ],
            'password' => [
                'required',
                'string',
                Password::min(8)->letters()->numbers(),
                'confirmed',
            ],
        ]);

        $user = DB::transaction(
            function () use ($validated): User {
                $user = User::create([
                    'name' => trim($validated['name']),
                    'email' => Str::lower(
                        trim($validated['email'])
                    ),
                    'password' => Hash::make(
                        $validated['password']
                    ),
                    'role' => self::ALLOWED_REGISTRATION_ROLE,
                    'is_active' => true,
                ]);

                $user->roles()->create([
                    'role' => self::ALLOWED_REGISTRATION_ROLE,
                ]);

                return $user;
            },
            3
        );

        $token = $user->createToken(
            self::TOKEN_NAME,
            ['*']
        )->plainTextToken;

        return response()->json([
            'message' => 'Registration successful.',
            'user' => $this->loadUserProfile($user),
            'token' => $token,
            'token_type' => 'Bearer',
        ], Response::HTTP_CREATED);
    }

    /**
     * Authenticate a user with rate limiting.
     *
     * Inactive accounts are denied. Role assignments are obtained
     * exclusively from the database.
     */
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => [
                'required',
                'string',
                'email',
                'max:255',
            ],
            'password' => [
                'required',
                'string',
            ],
        ]);

        $email = Str::lower(trim($validated['email']));

        $rateLimitKey = 'faga:login:' . hash(
            'sha256',
            $email . '|' . $request->ip()
        );

        if (RateLimiter::tooManyAttempts(
            $rateLimitKey,
            self::MAX_LOGIN_ATTEMPTS
        )) {
            return response()->json([
                'message' => 'Too many login attempts. Please try again later.',
                'retry_after' => RateLimiter::availableIn(
                    $rateLimitKey
                ),
            ], Response::HTTP_TOO_MANY_REQUESTS);
        }

        $user = User::query()
            ->where('email', $email)
            ->first();

        if (
            ! $user instanceof User ||
            ! Hash::check(
                $validated['password'],
                $user->password
            )
        ) {
            RateLimiter::hit(
                $rateLimitKey,
                self::LOGIN_DECAY_SECONDS
            );

            throw ValidationException::withMessages([
                'email' => [
                    'The provided credentials are incorrect.',
                ],
            ]);
        }

        if (! $user->is_active) {
            RateLimiter::hit(
                $rateLimitKey,
                self::LOGIN_DECAY_SECONDS
            );

            return response()->json([
                'message' => 'This account is inactive.',
            ], Response::HTTP_FORBIDDEN);
        }

        if (! $user->roles()->exists()) {
            return response()->json([
                'message' => 'No access role is assigned to this account.',
            ], Response::HTTP_FORBIDDEN);
        }

        RateLimiter::clear($rateLimitKey);

        $token = $user->createToken(
            self::TOKEN_NAME,
            ['*']
        )->plainTextToken;

        return response()->json([
            'message' => 'Login successful.',
            'user' => $this->loadUserProfile($user),
            'token' => $token,
            'token_type' => 'Bearer',
        ]);
    }

    /**
     * Return the authenticated user's permitted account data.
     */
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user instanceof User) {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], Response::HTTP_UNAUTHORIZED);
        }

        if (! $user->is_active) {
            return response()->json([
                'message' => 'This account is inactive.',
            ], Response::HTTP_FORBIDDEN);
        }

        return response()->json([
            'user' => $this->loadUserProfile($user),
        ]);
    }

    /**
     * Revoke the current Sanctum personal access token.
     *
     * This endpoint is intended for Bearer-token authentication.
     * Session-based authentication must use its own session logout
     * flow rather than deleting unrelated access tokens.
     */
    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user instanceof User) {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], Response::HTTP_UNAUTHORIZED);
        }

        $accessToken = $user->currentAccessToken();

        if (
            $accessToken === null ||
            ! method_exists($accessToken, 'delete')
        ) {
            return response()->json([
                'message' => 'No revocable access token was supplied.',
            ], Response::HTTP_BAD_REQUEST);
        }

        $accessToken->delete();

        return response()->json([
            'message' => 'Logout successful.',
        ]);
    }

    /**
     * Load relationships appropriate to the user's persisted roles.
     *
     * A user can hold multiple roles, but access to each private
     * endpoint must still be checked by middleware or a policy.
     */
    private function loadUserProfile(User $user): User
    {
        $user->load('roles');

        $roles = $user->roles
            ->pluck('role')
            ->all();

        $relations = [];

        if (in_array('customer', $roles, true)) {
            $relations[] = 'customerProfile';
            $relations[] = 'addresses';
        }

        if (in_array('rider', $roles, true)) {
            $relations[] = 'riderProfile.documents';
            $relations[] = 'riderProfile.vehicles';
        }

        if (in_array('seller', $roles, true)) {
            $relations[] = 'sellerProfile';
        }

        if (
            in_array('admin', $roles, true) ||
            in_array('super_admin', $roles, true)
        ) {
            $relations[] = 'adminProfile';
        }

        if ($relations !== []) {
            $user->load(array_unique($relations));
        }

        return $user;
    }
}
