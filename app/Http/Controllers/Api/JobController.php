<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Job;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class JobController extends Controller
{
    /**
     * List and search available jobs.
     */
    public function index(Request $request): JsonResponse
    {
        $query = Job::query()
            ->where('status', 'open')
            ->where(function ($query) {
                $query->whereNull('application_deadline')
                    ->orWhereDate(
                        'application_deadline',
                        '>=',
                        now()->toDateString()
                    );
            });

        /*
        |--------------------------------------------------------------------------
        | Search
        |--------------------------------------------------------------------------
        */

        if ($request->filled('search')) {
            $search = trim(
                $request->string('search')->toString()
            );

            $query->where(function ($query) use ($search) {
                $query->where('title', 'ilike', "%{$search}%")
                    ->orWhere('company_name', 'ilike', "%{$search}%")
                    ->orWhere('description', 'ilike', "%{$search}%")
                    ->orWhere('category', 'ilike', "%{$search}%")
                    ->orWhere('location', 'ilike', "%{$search}%")
                    ->orWhere('state', 'ilike', "%{$search}%");
            });
        }

        /*
        |--------------------------------------------------------------------------
        | Category filter
        |--------------------------------------------------------------------------
        */

        if ($request->filled('category')) {
            $query->where(
                'category',
                $request->string('category')->toString()
            );
        }

        /*
        |--------------------------------------------------------------------------
        | Employment type filter
        |--------------------------------------------------------------------------
        */

        if ($request->filled('employment_type')) {
            $query->where(
                'employment_type',
                $request->string('employment_type')->toString()
            );
        }

        /*
        |--------------------------------------------------------------------------
        | Location filter
        |--------------------------------------------------------------------------
        */

        if ($request->filled('location')) {
            $query->where(
                'location',
                'ilike',
                '%' . $request->string('location')->toString() . '%'
            );
        }

        /*
        |--------------------------------------------------------------------------
        | State filter
        |--------------------------------------------------------------------------
        */

        if ($request->filled('state')) {
            $query->where(
                'state',
                'ilike',
                '%' . $request->string('state')->toString() . '%'
            );
        }

        /*
        |--------------------------------------------------------------------------
        | Salary filters
        |--------------------------------------------------------------------------
        */

        if ($request->filled('salary_min')) {
            $query->where(
                'salary_max',
                '>=',
                $request->input('salary_min')
            );
        }

        if ($request->filled('salary_max')) {
            $query->where(
                'salary_min',
                '<=',
                $request->input('salary_max')
            );
        }

        /*
        |--------------------------------------------------------------------------
        | Sorting
        |--------------------------------------------------------------------------
        */

        $sort = $request->input('sort', 'latest');

        match ($sort) {
            'oldest' => $query->oldest(),

            'salary_high' => $query->orderByDesc('salary_max'),

            'salary_low' => $query->orderBy('salary_min'),

            default => $query->latest(),
        };

        /*
        |--------------------------------------------------------------------------
        | Pagination
        |--------------------------------------------------------------------------
        */

        $perPage = max(1, min((int) $request->input('per_page', 15), 50));

        $jobs = $query->paginate($perPage);

        return response()->json([
            'message' => 'Jobs retrieved successfully.',
            'jobs' => $jobs,
        ]);
    }

    /**
     * Show a single available job.
     */
    public function show(Job $job): JsonResponse
    {
        if ($job->status !== 'open') {
            return response()->json([
                'message' => 'This job is no longer available.',
            ], 404);
        }

        if (
            $job->application_deadline !== null &&
            $job->application_deadline->lt(today())
        ) {
            return response()->json([
                'message' =>
                    'The application deadline for this job has passed.',
            ], 404);
        }

        return response()->json([
            'message' => 'Job retrieved successfully.',
            'job' => $job,
        ]);
    }

    /** Only staff may manage published job listings. */
    private function authorizeStaff(Request $request): ?JsonResponse
    {
        if (! $request->user()->hasAnyRole(['admin', 'super_admin'])) {
            return response()->json(['message' => 'Administrator access required.'], 403);
        }
        return null;
    }

    /** Create a job listing; the poster is always the authenticated staff user. */
    public function store(Request $request): JsonResponse
    {
        if ($denied = $this->authorizeStaff($request)) return $denied;
        $data = $request->validate($this->jobRules());
        $data['posted_by'] = $request->user()->id;
        $job = Job::create($data);
        return response()->json(['message' => 'Job created successfully.', 'job' => $job], 201);
    }

    /** Edit a job; no client may change posted_by. */
    public function update(Request $request, Job $job): JsonResponse
    {
        if ($denied = $this->authorizeStaff($request)) return $denied;
        $data = $request->validate($this->jobRules(true));
        $job->update($data);
        return response()->json(['message' => 'Job updated successfully.', 'job' => $job->fresh()]);
    }

    /** Close a listing without deleting its application history. */
    public function close(Request $request, Job $job): JsonResponse
    {
        if ($denied = $this->authorizeStaff($request)) return $denied;
        $job->update(['status' => 'closed']);
        return response()->json(['message' => 'Job closed successfully.', 'job' => $job->fresh()]);
    }

    private function jobRules(bool $partial = false): array
    {
        $required = $partial ? 'sometimes' : 'required';
        return [
            'title' => [$required, 'string', 'max:255'],
            'company_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'description' => [$required, 'string', 'max:20000'],
            'category' => [$required, 'string', 'max:255'],
            'employment_type' => [$required, 'string', 'max:100'],
            'location' => [$required, 'string', 'max:255'],
            'state' => ['sometimes', 'nullable', 'string', 'max:255'],
            'country' => ['sometimes', 'string', 'max:255'],
            'salary_min' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'salary_max' => ['sometimes', 'nullable', 'numeric', 'min:0', 'gte:salary_min'],
            'salary_period' => ['sometimes', 'nullable', 'string', 'max:100'],
            'requirements' => ['sometimes', 'nullable', 'string', 'max:20000'],
            'responsibilities' => ['sometimes', 'nullable', 'string', 'max:20000'],
            'application_deadline' => ['sometimes', 'nullable', 'date'],
            'status' => ['sometimes', 'in:open,closed,draft'],
            'contact_email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'contact_phone' => ['sometimes', 'nullable', 'string', 'max:30'],
        ];
    }
}