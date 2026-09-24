import * as Sentry from "@sentry/nextjs"

// Next.js calls `register()` once per runtime on startup. This is how the
// server/edge Sentry configs actually get loaded — sentry.server.config.ts
// and sentry.edge.config.ts are not imported anywhere else.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        await import('./sentry.server.config')
    }

    if (process.env.NEXT_RUNTIME === 'edge') {
        await import('./sentry.edge.config')
    }
}

// Errors thrown while rendering a Server Component or running a route that
// Next.js catches itself. Without this hook they never reach Sentry: Next
// turns them into an error page and nothing is thrown past it.
export const onRequestError = Sentry.captureRequestError
