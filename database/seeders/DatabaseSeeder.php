<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\DB;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database with core accounts and validation roles.
     */
    public function run(): void
    {
        // 1. Create a Master Administrator Account
        $admin = User::create([
            'name' => 'FAGA Master Admin',
            'email' => 'admin@faga.ng',
            'password' => Hash::make('FagaAdminSecure2026!'),
            'role' => 'admin',
            'is_active' => true,
        ]);

        // LINK ADMIN ROLE KEY CARD
        DB::table('user_roles')->insert([
            'user_id' => $admin->id,
            'role'    => 'admin',
            'created_at' => now(),
            'updated_at' => now(),
        ]);


        // 2. Create a Mock Customer Account
        $customer = User::create([
            'name' => 'Abiodun Alao Test',
            'email' => 'customer@faga.ng',
            'password' => Hash::make('FagaCustomerPass123'),
            'role' => 'customer',
            'is_active' => true,
        ]);

        // LINK CUSTOMER ROLE KEY CARD
        DB::table('user_roles')->insert([
            'user_id' => $customer->id,
            'role'    => 'customer',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Open a wallet with spending cash for our test customer
        DB::table('wallets')->insert([
            'user_id' => $customer->id,
            'balance' => 25000.00, // Starts with ₦25,000 for test orders
            'escrow_balance' => 0.00,
            'created_at' => now(),
            'updated_at' => now(),
        ]);


        // 3. Create a Mock Driver/Rider Account
        $driver = User::create([
            'name' => 'Chinedu Okafor Rider',
            'email' => 'rider@faga.ng',
            'password' => Hash::make('FagaRiderPass123'),
            'role' => 'rider',
            'is_active' => true,
        ]);

        // LINK RIDER ROLE KEY CARD
        DB::table('user_roles')->insert([
            'user_id' => $driver->id,
            'role'    => 'rider',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Open a wallet for our test rider
        DB::table('wallets')->insert([
            'user_id' => $driver->id,
            'balance' => 0.00,
            'escrow_balance' => 0.00,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->command->info('🎉 FAGA Application database successfully seeded with access control role bindings!');
    }
}
