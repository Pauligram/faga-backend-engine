<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Log;

class NotificationDispatchService
{
    /**
     * Dispatch an automated email update notification alert.
     */
    public function sendEmail(string $recipientEmail, string $subject, string $messageBody): void
    {
        try {
            // Using Laravel's default Mail engine tied to our .env Mailgun settings
            Mail::raw($messageBody, function ($message) use ($recipientEmail, $subject) {
                $message->to($recipientEmail)
                        ->subject($subject);
            });
            Log::info("FAGA Mail Success: Dispatched alert email to [{$recipientEmail}]");
        } catch (\Exception $e) {
            Log::error("FAGA Mail Error: Could not route email alert: " . $e->getMessage());
        }
    }

    /**
     * Dispatch an automated text message (SMS) notification via Twilio APIs.
     */
    public function sendSMS(string $recipientPhone, string $smsMessage): void
    {
        // Skip execution processing if Twilio environment values are not fully configured
        if (config('services.twilio.sid') === 'ACXXXXXXXXXXXXXXXX') {
            Log::warning("FAGA SMS Warning: Twilio credentials placeholder detected. SMS dispatch bypassed.");
            return;
        }

        try {
            $sid = config('services.twilio.sid');
            $token = config('services.twilio.token');
            $from = config('services.twilio.from');

            $url = "https://twilio.com{$sid}/Messages.json";

            // Execute automated REST HTTP pipeline post to Twilio
            Http::withBasicAuth($sid, $token)
                ->asForm()
                ->post($url, [
                    'To'   => $recipientPhone,
                    'From' => $from,
                    'Body' => $smsMessage,
                ]);

            Log::info("FAGA SMS Success: Dispatched text verification alert to [{$recipientPhone}]");
        } catch (\Exception $e) {
            Log::error("FAGA SMS Error: Twilio gateway interface failure: " . $e->getMessage());
        }
    }
}
