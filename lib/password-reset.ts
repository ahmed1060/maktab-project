import { ApiResponse } from "@/lib/api-response"

/**
 * Too many tries to reset a password from one place, five in fifteen minutes
 * with asking for a code and using it counted together
 * (app/api/auth/forgot-password/*): refused with how long is left, in
 * seconds, counted here, so Forgot your password counts it down as signing in
 * does, without trusting the phone's clock (lib/sign-in-lock.ts,
 * holdMessage). It said a time to try again at, in English and in the
 * server's own time zone.
 */
export function resetHeldBack(resetAt: number, now: number = Date.now()) {
    return ApiResponse.refused(429, "Too many attempts. Please try again later.", "TOO_MANY_TRIES", {
        wait: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    })
}
