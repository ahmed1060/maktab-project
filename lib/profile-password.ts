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

/**
 * What the server answers about one's own password, by its code, in the
 * page's language (PR 229): too many wrong tries, from the profile's check
 * or the save, and a wrong current password, from a save that came after a
 * right one was checked, or a wrong one of the saver's own, for somebody
 * else's password or email (PR 231). Null for anything else.
 */
export function ownPasswordRefusal(body: { code?: unknown } | null): TranslationKey | null {
    if (body?.code === 'OWN_PASSWORD_TRIES') return 'own_password_tries'
    if (body?.code === 'CURRENT_PASSWORD_WRONG') return 'incorrect_password'
    // The saver's own, refused for somebody else's password or email (PR 231).
    if (body?.code === 'OWN_PASSWORD_WRONG') return 'incorrect_password'
    return null
}
