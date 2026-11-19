/**
 * Nizmo's own address, for a link in an email (CLIENT_PORTAL_PLAN.md §5.2;
 * PR 325). Never one read from the request: a request can name any host it
 * likes, and a link that carries an invitation's secret to another site
 * hands that site the account.
 *
 * - In production, Nizmo's address.
 * - On a preview, the preview's own address, which Vercel sets.
 * - Where Nizmo runs on this computer, the computer's own, as the request
 *   came to it.
 * - Anywhere else, Nizmo's address: a link that goes to Nizmo, even where
 *   it can't be used there, never to someone else.
 */

/** Nizmo's address in production. */
export const PRODUCTION_ORIGIN = "https://nizmo.vercel.app"

// A preview's address, as Vercel names them: one host, under vercel.app.
const PREVIEW_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/
// This computer, and nothing that only starts like it.
const THIS_COMPUTER = new Set(["localhost", "127.0.0.1"])

type Env = { VERCEL_ENV?: string; VERCEL_URL?: string }

export function appOrigin(requestUrl: string, env: Env = process.env as Env): string {
    if (env.VERCEL_ENV === "production") return PRODUCTION_ORIGIN
    if (env.VERCEL_ENV === "preview") return env.VERCEL_URL && PREVIEW_HOST.test(env.VERCEL_URL) ? `https://${env.VERCEL_URL}` : PRODUCTION_ORIGIN
    try {
        const url = new URL(requestUrl)
        if (THIS_COMPUTER.has(url.hostname) && (url.protocol === "http:" || url.protocol === "https:")) return url.origin
    } catch {
        // Not an address at all.
    }
    return PRODUCTION_ORIGIN
}
