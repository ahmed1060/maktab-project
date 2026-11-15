// This file configures the Sentry Edge Runtime SDK (middleware.ts and any
// route configured with `runtime: 'edge'`).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"
import { withoutTerminalSecrets } from "./lib/attendance/terminal-secrets"

Sentry.init({
    // With no DSN configured, the SDK is inert — no events are sent and
    // there is no runtime overhead beyond this no-op init call. Set
    // SENTRY_DSN to enable error reporting.
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    // No IP addresses, cookies or request bodies: payroll data stays out of
    // a third-party error tracker. See instrumentation-client.ts.
    sendDefaultPii: false,
    // A terminal straight to Nizmo is known by the secret in the address it
    // sends to (ATTENDANCE_PLAN.md §17.2): taken out of every address in an
    // error or a trace before it leaves.
    beforeSend: event => withoutTerminalSecrets(event),
    beforeSendTransaction: event => withoutTerminalSecrets(event),
    debug: false,
})
