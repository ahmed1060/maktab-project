import type { TranslationKey } from '@/lib/translations'

/**
 * What a refused password reset says, in the page's language (a person's
 * profile, part 2, PR 192): the route's refusals are in English
 * (app/api/users/[id]/reset-password/route.ts), and were shown as they came.
 */
export function resetRefusal(error: unknown): TranslationKey {
    if (error === 'Invalid admin password') return 'incorrect_password'
    if (error === "This person's role holds access yours doesn't") return 'profile_reset_exceeds'
    if (error === "Only the Super Admin resets an Admin's password") return 'profile_reset_admin_only'
    return 'profile_reset_failed'
}
