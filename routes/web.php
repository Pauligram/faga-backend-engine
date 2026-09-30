<?php

use Illuminate\Support\Facades\Route;

// Automatically intercepts root traffic and routes into the exact sub-folder casing space
Route::get('/', function () {
    return redirect('/frontend/Public%20website/index.html');
});