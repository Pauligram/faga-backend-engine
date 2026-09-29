<?php
declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\User;
use App\Services\TelemetryBufferService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

final class DeliveryStatusController extends Controller
{
    private const TRANSITIONS = [
        'PENDING_PAYMENT' => [
            'CONFIRMED',
            'CANCELLED',
            'FAILED',
        ],
        'CONFIRMED' => [
            'SEARCHING_FOR_RIDER',
            'CANCELLED',
            'FAILED',
        ],
        'SEARCHING_FOR_RIDER' => [
            'RIDER_ASSIGNED',
            'CANCELLED',
            'FAILED',
        ],
        'RIDER_ASSIGNED' => [
            'RIDER_EN_ROUTE_TO_PICKUP',
            'CANCELLED',
            'FAILED',
        ],
        'RIDER_EN_ROUTE_TO_PICKUP' => [
            'ARRIVED_AT_PICKUP',
            'CANCELLED',
            'FAILED',
        ],
        'ARRIVED_AT_PICKUP' => [
            'PICKED_UP',
            'CANCELLED',
            'FAILED',
        ],
        'PICKED_UP' => [
            'IN_TRANSIT',
            'FAILED',
        ],
        'IN_TRANSIT' => [
            'ARRIVED_AT_DROPOFF',
            'FAILED',
        ],
        'ARRIVED_AT_DROPOFF' => [
            'DELIVERED',
            'FAILED',
        ],
        'DELIVERED' => [],
        'CANCELLED' => [],
        'FAILED' => [],
    ];

    private const RIDER_TRANSITIONS = [
        'RIDER_EN_ROUTE_TO_PICKUP',
        'ARRIVED_AT_PICKUP',
        'PICKED_UP',
        'IN_TRANSIT',
        'ARRIVED_AT_DROPOFF',
        'DELIVERED',
    ];

    public function __construct(
        private readonly TelemetryBufferService $telemetry
    ) {}

    public function show(
        Request $request,
        Delivery $delivery
    ): JsonResponse {
        $user = $this->authenticatedUser($request);

        $this->authorizeDeliveryAccess(
            $user,
            $delivery
        );

        $history = DB::table('delivery_status_histories')
            ->where('delivery_id', $delivery->id)
            ->orderBy('id')
            ->get();

        return response()->json([
            'delivery_id' => $delivery->id,
            'status' => $delivery->status,
            'history' => $history,
            'location' => $this->canViewLocation(
                $user,
                $delivery
            )
                ? $this->telemetry->latest(
                    (int) $delivery->id
                )
                : null,
        ]);
    }

    public function update(
        Request $request,
        Delivery $delivery
    ): JsonResponse {
        $user = $this->authenticatedUser($request);

        $validated = $request->validate([
            'status' => [
                'required',
                'string',
                Rule::in(array_keys(self::TRANSITIONS)),
            ],
            'notes' => [
                'sometimes',
                'nullable',
                'string',
                'max:2000',
            ],
            'reason' => [
                'required_if:status,CANCELLED,FAILED',
                'nullable',
                'string',
                'max:1000',
            ],
        ]);

        $nextStatus = $validated['status'];

        try {
            $result = DB::transaction(
                function () use (
                    $delivery,
                    $user,
                    $validated,
                    $nextStatus
                ): array {
                    $locked = Delivery::query()
                        ->whereKey($delivery->getKey())
                        ->lockForUpdate()
                        ->firstOrFail();

                    $this->authorizeTransition(
                        $user,
                        $locked,
                        $nextStatus
                    );

                    $previousStatus = (string) $locked->status;

                    if (
                        ! in_array(
                            $nextStatus,
                            self::TRANSITIONS[$previousStatus] ?? [],
                            true
                        )
                    ) {
                        throw ValidationException::withMessages([
                            'status' => [
                                'The requested delivery status transition is not permitted.',
                            ],
                        ]);
                    }

                    $timestamp = now();

                    $changes = [
                        'status' => $nextStatus,
                        'updated_at' => $timestamp,
                    ];

                    if ($nextStatus === 'DELIVERED') {
                        $changes['delivered_at'] = $timestamp;
                    }

                    if ($nextStatus === 'CANCELLED') {
                        $changes['cancelled_at'] = $timestamp;
                        $changes['cancellation_reason'] =
                            $validated['reason'];
                    }

                    $updated = DB::table('deliveries')
                        ->where('id', $locked->id)
                        ->where('status', $previousStatus)
                        ->update($changes);

                    if ($updated !== 1) {
                        throw new RuntimeException(
                            'Concurrent delivery update detected.'
                        );
                    }

                    DB::table('delivery_status_histories')->insert([
                        'delivery_id' => $locked->id,
                        'status' => $nextStatus,
                        'changed_by' => $user->id,
                        'notes' => $validated['notes']
                            ?? $validated['reason']
                            ?? null,
                        'created_at' => $timestamp,
                        'updated_at' => $timestamp,
                    ]);

                    return [
                        'delivery_id' => $locked->id,
                        'previous_status' => $previousStatus,
                        'status' => $nextStatus,
                        'updated_at' => $timestamp->toIso8601String(),
                    ];
                },
                3
            );
        } catch (ValidationException $exception) {
            throw $exception;
        } catch (Throwable $exception) {
            Log::error(
                'Delivery status update failed.',
                [
                    'delivery_id' => $delivery->id,
                    'actor_id' => $user->id,
                    'requested_status' => $nextStatus,
                    'exception' => $exception::class,
                ]
            );

            return response()->json([
                'message' => 'Unable to update delivery status.',
            ], Response::HTTP_CONFLICT);
        }

        if (
            in_array(
                $nextStatus,
                ['DELIVERED', 'CANCELLED', 'FAILED'],
                true
            )
        ) {
            try {
                $this->telemetry->clear(
                    (int) $delivery->id
                );
            } catch (Throwable $exception) {
                Log::warning(
                    'Terminal delivery telemetry cleanup failed.',
                    [
                        'delivery_id' => $delivery->id,
                        'exception' => $exception::class,
                    ]
                );
            }
        }

        return response()->json([
            'message' => 'Delivery status updated.',
            'delivery' => $result,
        ]);
    }

    public function location(
        Request $request,
        Delivery $delivery
    ): JsonResponse {
        $user = $this->authenticatedUser($request);

        $this->authorizeDeliveryAccess(
            $user,
            $delivery
        );

        if (! $this->canViewLocation($user, $delivery)) {
            return response()->json([
                'message' => 'Location tracking is unavailable.',
            ], Response::HTTP_FORBIDDEN);
        }

        return response()->json([
            'delivery_id' => $delivery->id,
            'location' => $this->telemetry->latest(
                (int) $delivery->id
            ),
        ]);
    }

    public function updateLocation(
        Request $request,
        Delivery $delivery
    ): JsonResponse {
        $user = $this->authenticatedUser($request);

        if (
            ! $this->hasRole($user, 'rider') ||
            (int) $delivery->rider_id !== (int) $user->id
        ) {
            return response()->json([
                'message' => 'Only the assigned rider can update this location.',
            ], Response::HTTP_FORBIDDEN);
        }

        $validated = $request->validate([
            'latitude' => [
                'required',
                'numeric',
                'between:-90,90',
            ],
            'longitude' => [
                'required',
                'numeric',
                'between:-180,180',
            ],
            'accuracy_meters' => [
                'required',
                'numeric',
                'between:0,1000',
            ],
            'recorded_at' => [
                'required',
                'date',
            ],
        ]);

        try {
            $recordedAt = CarbonImmutable::parse(
                $validated['recorded_at']
            );

            $result = $this->telemetry->ingest(
                (int) $user->id,
                (int) $delivery->id,
                (float) $validated['latitude'],
                (float) $validated['longitude'],
                (float) $validated['accuracy_meters'],
                $recordedAt
            );

            return response()->json([
                'message' => $result['accepted']
                    ? 'Location received.'
                    : 'Older location ignored.',
                'location' => $result,
            ], Response::HTTP_ACCEPTED);
        } catch (\InvalidArgumentException $exception) {
            throw ValidationException::withMessages([
                'location' => [$exception->getMessage()],
            ]);
        } catch (Throwable $exception) {
            Log::error(
                'Rider telemetry ingestion failed.',
                [
                    'delivery_id' => $delivery->id,
                    'rider_id' => $user->id,
                    'exception' => $exception::class,
                ]
            );

            return response()->json([
                'message' => 'Unable to process location update.',
            ], Response::HTTP_SERVICE_UNAVAILABLE);
        }
    }

    private function authenticatedUser(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            abort(
                Response::HTTP_UNAUTHORIZED,
                'Authentication required.'
            );
        }

        if (! (bool) $user->is_active) {
            abort(
                Response::HTTP_FORBIDDEN,
                'Account inactive.'
            );
        }

        return $user;
    }

    private function authorizeDeliveryAccess(
        User $user,
        Delivery $delivery
    ): void {
        if (
            $this->hasAnyRole(
                $user,
                ['admin', 'super_admin', 'dispatcher']
            ) ||
            (
                $this->hasRole($user, 'customer') &&
                (int) $delivery->customer_id === (int) $user->id
            ) ||
            (
                $this->hasRole($user, 'rider') &&
                (int) $delivery->rider_id === (int) $user->id
            )
        ) {
            return;
        }

        abort(
            Response::HTTP_FORBIDDEN,
            'You cannot access this delivery.'
        );
    }

    private function authorizeTransition(
        User $user,
        Delivery $delivery,
        string $nextStatus
    ): void {
        if (
            $this->hasAnyRole(
                $user,
                ['admin', 'super_admin', 'dispatcher']
            )
        ) {
            return;
        }

        if (
            $this->hasRole($user, 'rider') &&
            (int) $delivery->rider_id === (int) $user->id &&
            in_array(
                $nextStatus,
                self::RIDER_TRANSITIONS,
                true
            )
        ) {
            return;
        }

        if (
            $this->hasRole($user, 'customer') &&
            (int) $delivery->customer_id === (int) $user->id &&
            $nextStatus === 'CANCELLED' &&
            in_array(
                $delivery->status,
                [
                    'PENDING_PAYMENT',
                    'CONFIRMED',
                    'SEARCHING_FOR_RIDER',
                ],
                true
            )
        ) {
            return;
        }

        abort(
            Response::HTTP_FORBIDDEN,
            'You cannot perform this delivery transition.'
        );
    }

    private function canViewLocation(
        User $user,
        Delivery $delivery
    ): bool {
        return in_array(
            $delivery->status,
            [
                'RIDER_ASSIGNED',
                'RIDER_EN_ROUTE_TO_PICKUP',
                'ARRIVED_AT_PICKUP',
                'PICKED_UP',
                'IN_TRANSIT',
                'ARRIVED_AT_DROPOFF',
            ],
            true
        );
    }

    private function hasRole(
        User $user,
        string $role
    ): bool {
        return (string) $user->role === $role;
    }

    /**
     * @param array<int, string> $roles
     */
    private function hasAnyRole(
        User $user,
        array $roles
    ): bool {
        return in_array(
            (string) $user->role,
            $roles,
            true
        );
    }
}