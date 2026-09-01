// This file configures the Sentry browser client. It runs whenever a page
// loads in the browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"

Sentry.init({
    // With no DSN configured, the SDK is inert — no events are sent and
    // there is no runtime overhead beyond this no-op init call. Set
    // NEXT_PUBLIC_SENTRY_DSN to enable error reporting.
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    debug: false,
})
