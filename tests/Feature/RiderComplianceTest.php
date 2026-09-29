<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

class RiderComplianceTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_driver_can_securely_upload_verification_paperwork_into_private_storage()
    {
        // 1. Fake the storage disk system so we do not clutter your real computer files during runs
        Storage::fake('local');

        // 2. Setup mock driver profile authentication references
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        // 3. Mock up a fake high-resolution image file labeled driver_license.jpg
       $fakeDocument = UploadedFile::fake()->create('driver_license.pdf', 100); // 100 KB size placeholder

        $payload = [
            'document_type' => 'DRIVERS_LICENSE',
            'document_file' => $fakeDocument
        ];

        // 4. FIRE! Execute the transaction pathway request parameters
        $response = $this->postJson('/api/rider/documents/upload', $payload);

        // 5. ASSERT CHECKS: Make sure the vault responses assert status 201 (Created Successfully)
        $response->assertStatus(201);
        $response->assertJson(['success' => true]);

        // Verify that the file was actually written safely inside the private internal folder vault
        $this->assertDatabaseHas('rider_documents', [
            'document_type' => 'DRIVERS_LICENSE',
            'status'        => 'PENDING'
        ]);

        $recordedDoc = \App\Models\RiderDocument::first();
        Storage::disk('local')->assertExists($recordedDoc->file_path);
    }
}
