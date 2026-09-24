import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * Sentry is only as good as the paths that reach it.
 *
 * The SDK was installed and initialised long before it was switched on, and
 * three of those paths could never have reported anything: the browser
 * config sat under a filename Turbopack does not load, errors Next.js catches
 * while rendering had no hook, and every error this app catches itself (API
 * handler, error boundaries, the root error page) was logged locally and
 * swallowed. Each of these is invisible in a click-through — the page looks
 * the same either way — so it is asserted here.
 */

const code = (path: string) => stripComments(readFileSync(path, "utf8"))

describe("the SDK is loaded where Next 16 looks for it", () => {
    it("browser: instrumentation-client.ts, not the old sentry.client.config.ts", () => {
        expect(existsSync("sentry.client.config.ts")).toBe(false)
        const client = code("instrumentation-client.ts")
        expect(client).toContain("Sentry.init(")
        expect(client).toContain("process.env.NEXT_PUBLIC_SENTRY_DSN")
        expect(client).toContain("export const onRouterTransitionStart = Sentry.captureRouterTransitionStart")
    })

    it("server: errors Next.js catches while rendering are handed over", () => {
        expect(code("instrumentation.ts")).toContain("export const onRequestError = Sentry.captureRequestError")
    })
})

describe("errors the app catches itself still reach Sentry", () => {
    it("the API handler, tagged with the reference the person was shown", () => {
        const api = code("lib/api-utils.ts")
        const handlerCatch = api.slice(api.indexOf("const ref = await AuditLogService.logSystemError"))
        expect(handlerCatch).toMatch(/Sentry\.captureException\(error, \{\s*tags: \{ ref,/)
        // Before the response, or a return would skip it.
        expect(handlerCatch.indexOf("Sentry.captureException")).toBeLessThan(handlerCatch.indexOf("return ApiResponse.error"))
    })

    it("error boundaries, through the one reporting helper they all use", () => {
        const report = code("lib/client-error-report.ts")
        const fn = report.slice(report.indexOf("export async function reportClientError"))
        expect(fn.indexOf("captureInSentry(")).toBeLessThan(fn.indexOf("await fetch("))
        expect(report).toContain("Sentry.captureException(error")
    })

    it("the root error page", () => {
        expect(code("app/global-error.tsx")).toContain("Sentry.captureException(error)")
    })
})

describe("payroll data stays out of it", () => {
    for (const path of ["instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts"]) {
        it(`${path} sends no IPs, cookies or request bodies`, () => {
            expect(code(path)).toContain("sendDefaultPii: false")
        })
    }

    it("records no sessions — Replay would film the salary screens", () => {
        for (const path of ["instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts"]) {
            expect(code(path)).not.toMatch(/replayIntegration|replaysSessionSampleRate|replaysOnErrorSampleRate/)
        }
    })
})

describe("browser reports go through this site, and the proxy lets them", () => {
    it("tunnels through /monitoring", () => {
        expect(code("next.config.mjs")).toContain("tunnelRoute: '/monitoring'")
    })

    it("proxy.ts does not intercept the tunnel, and still covers the app", () => {
        // A redirect here (sign-in, maintenance, a locked subscription) would
        // turn every error report into a login page.
        const proxy = code("proxy.ts")
        const pattern = proxy.match(/'(\/\(\(\?!api[^']+)'/)?.[1]
        expect(pattern, "matcher pattern").toBeTruthy()
        const matcher = new RegExp(`^${pattern!.replace(/\\\\/g, "\\")}$`)
        expect(matcher.test("/monitoring")).toBe(false)
        expect(matcher.test("/dashboard")).toBe(true)
        expect(matcher.test("/dashboard/employees")).toBe(true)
        expect(matcher.test("/login")).toBe(true)
    })
})
