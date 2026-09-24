// The Sentry browser client. Next.js loads this file itself before the app
// hydrates; it replaced sentry.client.config.ts, which Turbopack — the default
// bundler since Next 16 — never loads, so under the old name browser errors
// were silently never reported.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"

Sentry.init({
    // With no DSN configured, the SDK is inert — no events are sent. Set
    // NEXT_PUBLIC_SENTRY_DSN to enable error reporting.
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    // Off, deliberately. This app shows salaries, payslips and settlements;
    // IP addresses, cookies and request bodies stay out of a third-party
    // error tracker. Session Replay is left out for the same reason — it
    // would record exactly those screens.
    sendDefaultPii: false,
    debug: false,
})

// Links a client-side navigation to the trace of the page it lands on.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
