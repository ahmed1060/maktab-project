import type { TranslationKey } from "@/lib/translations"

/**
 * What a username may be, wherever one is typed or made up (a company's
 * code and a number, a Super Admin's from their email): 2 to 30 letters,
 * digits, dots, hyphens or underscores, starting with a letter or a digit.
 * Never an @ or a space, so signing in can tell one from an email. Capitals
 * are kept as typed; two that differ only in them are the same username
 * (lib/username.ts). Pure, so a form can check one as it's typed.
 */
export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,29}$/

/** What's wrong with a typed username; null when it'll do. */
export function usernameError(name: string): TranslationKey | null {
    return USERNAME_PATTERN.test(name.trim()) ? null : 'username_invalid'
}

/**
 * A username for a Super Admin added without one: their email's part before
 * the @, kept to what a username may have, short enough for "-2" after it.
 */
export function usernameFromEmail(email: string): string {
    const kept = (email.split('@')[0] ?? '')
        .replace(/[^A-Za-z0-9._-]/g, '')
        .replace(/^[^A-Za-z0-9]+/, '')
        .slice(0, 26)
    return kept.length >= 2 ? kept : 'admin'
}

/** The username a profile form sends: only one that's been changed. */
export function changedUsername(typed: string, saved: string): string | undefined {
    const trimmed = typed.trim()
    return trimmed === saved ? undefined : trimmed
}

/**
 * Whether a save was refused for a username somebody was given a moment
 * before: the check passed, and the database's own (capitals aside) caught
 * it. Prisma names the column, or the index, in the error's meta.
 */
export function isUsernameClash(error: unknown): boolean {
    return (error as { code?: string })?.code === "P2002" && /username/i.test(JSON.stringify((error as { meta?: unknown }).meta ?? {}))
}
