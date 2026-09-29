<?php
declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Finance\WalletService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

final class WalletController extends Controller
{
    public function __construct(
        private readonly WalletService $wallets
    ) {}

    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user->is_active) {
            return response()->json([
                'message' => 'Account inactive.',
            ], Response::HTTP_FORBIDDEN);
        }

        return response()->json([
            'currency' => 'NGN',
            'available_balance_minor' => $this->wallets
                ->availableBalance((int) $user->id),
        ]);
    }

    public function transactions(Request $request): JsonResponse
    {
        $accountId = $this->wallets->walletAccount(
            (int) $request->user()->id
        );

        $entries = DB::table('ledger_entries as e')
            ->join(
                'ledger_transactions as t',
                't.id',
                '=',
                'e.transaction_id'
            )
            ->where('e.account_id', $accountId)
            ->select([
                't.id as transaction_id',
                't.reference',
                't.type',
                't.status',
                'e.direction',
                'e.amount_minor',
                'e.currency',
                'e.created_at',
            ])
            ->orderByDesc('e.id')
            ->paginate(25);

        return response()->json($entries);
    }

    public function withdraw(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'amount_minor' => [
                'required',
                'integer',
                'min:100',
                'max:1000000000',
            ],
            'idempotency_key' => [
                'required',
                'string',
                'uuid',
            ],
        ]);

        $user = $request->user();

        if (
            ! $user->is_active ||
            ! $user->hasAnyRole(['rider', 'seller', 'service_provider'])
        ) {
            return response()->json([
                'message' => 'Withdrawals are not permitted for this account.',
            ], Response::HTTP_FORBIDDEN);
        }

        try {
            $withdrawalId = $this->wallets->requestWithdrawal(
                (int) $user->id,
                (int) $validated['amount_minor'],
                $validated['idempotency_key']
            );
        } catch (\RuntimeException $exception) {
            throw ValidationException::withMessages([
                'amount_minor' => [$exception->getMessage()],
            ]);
        }

        return response()->json([
            'message' => 'Withdrawal reserved for processing.',
            'withdrawal_id' => $withdrawalId,
            'status' => 'pending',
        ], Response::HTTP_ACCEPTED);
    }

    public function withdrawals(Request $request): JsonResponse
    {
        $withdrawals = DB::table('withdrawal_requests')
            ->where('user_id', $request->user()->id)
            ->select([
                'id',
                'currency',
                'amount_minor',
                'status',
                'created_at',
                'updated_at',
            ])
            ->orderByDesc('created_at')
            ->paginate(25);

        return response()->json($withdrawals);
    }
}
