import { redirect } from 'next/navigation'

/**
 * Moved into Security Settings. Kept as a redirect rather than deleted: this
 * path was where middleware.ts sent every unverified account for as long as
 * email verification has existed, so it is in browser histories and bookmarks.
 * A 404 there is a dead end on the one screen somebody may be locked behind.
 */
export default function MovedPage() {
    redirect('/dashboard/security-settings')
}
