<?php

namespace Tests\Feature;

use App\Models\Job;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class JobApiTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Create an authenticated customer.
     */
    private function customer(): User
    {
        return User::factory()->create([
            'role' => 'customer',
            'is_active' => true,
        ]);
    }

    /**
     * Create a standard open job.
     */
    private function createJob(
        User $user,
        array $overrides = []
    ): Job {
        return Job::create(array_merge([
            'posted_by' => $user->id,
            'title' => 'Software Developer',
            'company_name' => 'FAGA Technologies',
            'description' => 'We are looking for a software developer.',
            'category' => 'Information Technology',
            'employment_type' => 'full_time',
            'location' => 'Lagos',
            'state' => 'Lagos',
            'country' => 'Nigeria',
            'salary_min' => 200000,
            'salary_max' => 400000,
            'salary_period' => 'monthly',
            'requirements' => 'PHP, Laravel and PostgreSQL.',
            'responsibilities' => 'Develop and maintain software applications.',
            'application_deadline' => now()->addMonth()->toDateString(),
            'status' => 'open',
            'contact_email' => 'jobs@faga.com',
            'contact_phone' => '08000000000',
        ], $overrides));
    }

    /**
     * Customer can list available jobs.
     */
    public function test_customer_can_list_available_jobs(): void
    {
        $customer = $this->customer();

        $this->createJob($customer);

        Sanctum::actingAs($customer);

        $response = $this->getJson('/api/jobs');

        $response
            ->assertOk()
            ->assertJsonPath(
                'message',
                'Jobs retrieved successfully.'
            )
            ->assertJsonCount(
                1,
                'jobs.data'
            );
    }

    /**
     * Customer can view a job.
     */
    public function test_customer_can_view_a_job(): void
    {
        $customer = $this->customer();

        $job = $this->createJob($customer);

        Sanctum::actingAs($customer);

        $response = $this->getJson(
            "/api/jobs/{$job->id}"
        );

        $response
            ->assertOk()
            ->assertJsonPath(
                'job.id',
                $job->id
            )
            ->assertJsonPath(
                'job.title',
                'Software Developer'
            );
    }

    /**
     * Customer can search jobs.
     */
    public function test_customer_can_search_jobs(): void
    {
        $customer = $this->customer();

        $this->createJob($customer, [
            'title' => 'Software Developer',
        ]);

        $this->createJob($customer, [
            'title' => 'Accountant',
            'category' => 'Accounting',
            'description' => 'We are looking for an experienced accountant.',
        ]);

        Sanctum::actingAs($customer);

        $response = $this->getJson(
            '/api/jobs?search=developer'
        );

        $response
            ->assertOk()
            ->assertJsonCount(
                1,
                'jobs.data'
            )
            ->assertJsonPath(
                'jobs.data.0.title',
                'Software Developer'
            );
    }

    /**
     * Customer can filter jobs by category.
     */
    public function test_customer_can_filter_jobs_by_category(): void
    {
        $customer = $this->customer();

        $this->createJob($customer);

        $this->createJob($customer, [
            'title' => 'Accountant',
            'category' => 'Accounting',
        ]);

        Sanctum::actingAs($customer);

        $response = $this->getJson(
            '/api/jobs?category=Accounting'
        );

        $response
            ->assertOk()
            ->assertJsonCount(
                1,
                'jobs.data'
            )
            ->assertJsonPath(
                'jobs.data.0.category',
                'Accounting'
            );
    }

    /**
     * Customer can filter jobs by location.
     */
    public function test_customer_can_filter_jobs_by_location(): void
    {
        $customer = $this->customer();

        $this->createJob($customer, [
            'location' => 'Lagos',
        ]);

        $this->createJob($customer, [
            'title' => 'Developer Abuja',
            'location' => 'Abuja',
            'state' => 'FCT',
        ]);

        Sanctum::actingAs($customer);

        $response = $this->getJson(
            '/api/jobs?location=Abuja'
        );

        $response
            ->assertOk()
            ->assertJsonCount(
                1,
                'jobs.data'
            )
            ->assertJsonPath(
                'jobs.data.0.location',
                'Abuja'
            );
    }

    /**
     * Closed jobs are not listed.
     */
    public function test_closed_jobs_are_not_listed(): void
    {
        $customer = $this->customer();

        $this->createJob($customer, [
            'status' => 'closed',
        ]);

        Sanctum::actingAs($customer);

        $response = $this->getJson('/api/jobs');

        $response
            ->assertOk()
            ->assertJsonCount(
                0,
                'jobs.data'
            );
    }

    /**
     * Expired jobs are not listed.
     */
    public function test_expired_jobs_are_not_listed(): void
    {
        $customer = $this->customer();

        $this->createJob($customer, [
            'application_deadline' => now()
                ->subDay()
                ->toDateString(),
        ]);

        Sanctum::actingAs($customer);

        $response = $this->getJson('/api/jobs');

        $response
            ->assertOk()
            ->assertJsonCount(
                0,
                'jobs.data'
            );
    }

    /**
     * Customer cannot view a closed job.
     */
    public function test_customer_cannot_view_closed_job(): void
    {
        $customer = $this->customer();

        $job = $this->createJob($customer, [
            'status' => 'closed',
        ]);

        Sanctum::actingAs($customer);

        $response = $this->getJson(
            "/api/jobs/{$job->id}"
        );

        $response
            ->assertNotFound()
            ->assertJsonPath(
                'message',
                'This job is no longer available.'
            );
    }

    /**
     * Customer cannot view an expired job.
     */
    public function test_customer_cannot_view_expired_job(): void
    {
        $customer = $this->customer();

        $job = $this->createJob($customer, [
            'application_deadline' => now()
                ->subDay()
                ->toDateString(),
        ]);

        Sanctum::actingAs($customer);

        $response = $this->getJson(
            "/api/jobs/{$job->id}"
        );

        $response
            ->assertNotFound()
            ->assertJsonPath(
                'message',
                'The application deadline for this job has passed.'
            );
    }

    /**
     * Unauthenticated users cannot access jobs.
     */
    public function test_unauthenticated_user_cannot_access_jobs(): void
    {
        $response = $this->getJson('/api/jobs');

        $response->assertUnauthorized();
    }
}