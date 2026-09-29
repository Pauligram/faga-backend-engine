<?php
declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EnsureUserHasRole
{
    /**
     * Roles must be explicitly assigned to a user. An administrator
     * cannot access another role's endpoints unless that role is
     * also assigned.
     *
     * Usage: ->middleware('role:admin,super_admin')
     */
    public function handle(
        Request $request,
        Closure $next,
        string ...$roles
    ): Response {
        $user = $request->user();

        if (! $user instanceof User) {
            return $this->deny(
                'Authentication is required.',
                Response::HTTP_UNAUTHORIZED
            );
        }

        if (! $user->is_active) {
            return $this->deny(
                'This account is inactive.',
                Response::HTTP_FORBIDDEN
            );
        }

        $allowedRoles = array_values(
            array_unique(
                array_filter(
                    array_map(
                        static fn (string $role): string => strtolower(trim($role)),
                        $roles
                    ),
                    static fn (string $role): bool => $role !== ''
                )
            )
        );

        if ($allowedRoles === []) {
            return $this->deny(
                'Access is not configured for this resource.',
                Response::HTTP_FORBIDDEN
            );
        }

        // Always check persisted assignments, not a client-supplied
        // role or a potentially stale relationship loaded earlier.
        if (! $user->roles()
            ->whereIn('role', $allowedRoles)
            ->exists()
        ) {
            return $this->deny(
                'You do not have permission to access this resource.',
                Response::HTTP_FORBIDDEN
            );
        }

        return $next($request);
    }

    private function deny(string $message, int $status): JsonResponse
    {
        return response()->json([
            'message' => $message,
        ], $status);
    }
}
