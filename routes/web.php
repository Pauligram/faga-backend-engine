<?php

use Illuminate\Support\Facades\Route;

// Instantly routes the core domain down to the exact public frontend relative path
Route::get('/', function () {
    return redirect('/public/frontend/user portal/login.html');
});
