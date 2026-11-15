import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { isPushSecret, newPushSecret, withoutTerminalSecrets, HIKVISION_ROUTE } from "./terminal-secrets"
import { stripComments } from "../strip-comments"

/**
 * The secret in the address a Hikvision terminal sends to
 * (ATTENDANCE_PLAN.md §17.2, PR 291): what one looks like, and that it is
 * taken out of anything Nizmo keeps or sends on.
 */

describe("a terminal's secret", () => {
    it("is 32 random bytes, written for an address", () => {
        const secret = newPushSecret()
        expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(Buffer.from(secret, "base64url")).toHaveLength(32)
        expect(new Set(Array.from({ length: 50 }, newPushSecret)).size).toBe(50)
    })

    it("is told from anything else by its shape, before the database is asked", () => {
        expect(isPushSecret(newPushSecret())).toBe(true)
        for (const not of ["", "x", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}/`, `${"a".repeat(42)}.`, `${"a".repeat(42)} `, "mka_" + "a".repeat(43), "../../admin"]) {
            expect(isPushSecret(not), JSON.stringify(not)).toBe(false)
        }
    })
})

describe("taking the secret out", () => {
    const secret = "S".repeat(43)

    it("leaves the route's pattern in its place, wherever an address appears", () => {
        expect(HIKVISION_ROUTE).toBe("/api/terminals/hikvision/[secret]")
        expect(withoutTerminalSecrets(`/api/terminals/hikvision/${secret}`)).toBe(HIKVISION_ROUTE)
        expect(withoutTerminalSecrets(`https://nizmo.example/api/terminals/hikvision/${secret}?x=1`)).toBe("https://nizmo.example/api/terminals/hikvision/[secret]?x=1")
        expect(withoutTerminalSecrets(`POST /api/terminals/hikvision/${secret} failed; again /api/terminals/hikvision/${secret}#top`))
            .toBe("POST /api/terminals/hikvision/[secret] failed; again /api/terminals/hikvision/[secret]#top")
        // A guess that isn't a secret's shape is taken out too: it may be a real one, mistyped.
        expect(withoutTerminalSecrets("/api/terminals/hikvision/almost-a-secret")).toBe(HIKVISION_ROUTE)
        expect(withoutTerminalSecrets("/api/attendance/devices")).toBe("/api/attendance/devices")
    })

    it("reaches every address in what is sent to the error tracker, and leaves the rest as it was", () => {
        const event = {
            transaction: `POST /api/terminals/hikvision/${secret}`,
            request: { url: `https://nizmo.example/api/terminals/hikvision/${secret}`, method: "POST" },
            spans: [{ description: `POST /api/terminals/hikvision/${secret}`, data: { "http.target": `/api/terminals/hikvision/${secret}`, "http.status_code": 200 } }],
            breadcrumbs: [{ message: `fetch https://nizmo.example/api/terminals/hikvision/${secret}` }],
            tags: { ref: "ERR-1" }, level: "error", timestamp: 1794747848.5,
        }
        const out = withoutTerminalSecrets(event)
        expect(JSON.stringify(out)).not.toContain(secret)
        expect(out).toEqual({
            transaction: "POST /api/terminals/hikvision/[secret]",
            request: { url: "https://nizmo.example/api/terminals/hikvision/[secret]", method: "POST" },
            spans: [{ description: "POST /api/terminals/hikvision/[secret]", data: { "http.target": "/api/terminals/hikvision/[secret]", "http.status_code": 200 } }],
            breadcrumbs: [{ message: "fetch https://nizmo.example/api/terminals/hikvision/[secret]" }],
            tags: { ref: "ERR-1" }, level: "error", timestamp: 1794747848.5,
        })
        // Nothing about terminals in it: handed back as it is, not copied.
        const other = { transaction: "GET /api/tasks", request: { url: "https://nizmo.example/api/tasks" } }
        expect(withoutTerminalSecrets(other)).toBe(other)
        expect(withoutTerminalSecrets(null)).toBeNull()
    })

    it("is done to every error and trace before it leaves, on the server and at the edge", () => {
        for (const path of ["sentry.server.config.ts", "sentry.edge.config.ts"]) {
            const config = stripComments(readFileSync(path, "utf8"))
            expect(config, path).toMatch(/beforeSend: event => withoutTerminalSecrets\(event\)/)
            expect(config, path).toMatch(/beforeSendTransaction: event => withoutTerminalSecrets\(event\)/)
        }
    })

    it("is done to the route named in a failure's audit entry", () => {
        const handler = stripComments(readFileSync("lib/attendance/terminal-handler.ts", "utf8"))
        expect(handler).toContain("route: HIKVISION_ROUTE")
        expect(handler).not.toMatch(/route: new URL\(req\.url\)\.pathname/)
        // Nor is the secret written to the server's own log.
        expect(handler).not.toMatch(/console\.\w+\([^)]*secret/)
    })
})
