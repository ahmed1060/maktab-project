import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { CONNECTIONS_BUILT, mayConnect } from "./attendance/terminal-connections"
import { PER_TERMINAL_PER_MINUTE, UNKNOWN_PER_ADDRESS } from "./attendance/terminal-handler"
import { ELSEWHERE_NOTED_EVERY_MS } from "./attendance/zkteco-handler"

/**
 * The addresses a ZKTeco terminal calls, as they are wired
 * (ATTENDANCE_PLAN.md §17.3, Phase 4 part 6, PR 296): outside the proxy,
 * read by Vercel's own word for where a request came from, and answering
 * a ZKTeco terminal added straight to Nizmo from its office's address
 * (PR 297). What they do with a request is in lib/terminal-adms.db.test.ts, against a real
 * Postgres, and how a request is read in
 * lib/attendance/zkteco-adms.test.ts.
 */

const source = (path: string) => stripComments(readFileSync(path, "utf8"))

describe("the proxy", () => {
    const pattern = /matcher:\s*\[\s*'([^']+)'/.exec(source("proxy.ts"))?.[1]
    const matcher = new RegExp(`^${pattern!.replace(/\\\\/g, "\\")}$`)

    it("leaves /iclock alone, as it leaves /api: a terminal sent to the sign-in page would never follow", () => {
        expect(pattern, "matcher pattern").toBeTruthy()
        for (const path of ["/iclock/cdata", "/iclock/getrequest", "/iclock/devicecmd", "/iclock/registry", "/iclock/cdata.aspx"]) expect(matcher.test(path), path).toBe(false)
        expect(matcher.test("/api/terminals/hikvision/x")).toBe(false)
    })

    it("still stands before every page", () => {
        for (const path of ["/dashboard", "/dashboard/settings", "/login", "/", "/dashboard/iclock"]) expect(matcher.test(path), path).toBe(true)
    })
})

describe("the route", () => {
    const route = source("app/iclock/[...path]/route.ts")

    it("is at the root of Nizmo's address, where the protocol fixes it, for every path under it", () => {
        expect(existsSync("app/iclock/[...path]/route.ts")).toBe(true)
        // Not under /api: a terminal can't be told another path.
        expect(existsSync("app/api/iclock")).toBe(false)
    })

    it("takes a GET and a POST, each answered as the request comes, never from a cache", () => {
        expect(route).toContain("export async function GET(req: Request)")
        expect(route).toContain("export async function POST(req: Request)")
        expect(route).toContain(`export const dynamic = "force-dynamic"`)
        expect(route.match(/return receiveZkteco\(req\)/g)).toHaveLength(2)
    })
})

describe("whose request it is", () => {
    const handler = source("lib/attendance/zkteco-handler.ts")

    it("is read from Vercel's own header alone, which a caller can't set", () => {
        expect(handler).toContain(`headers.get("x-vercel-forwarded-for")`)
        // Not the header a caller can prepend to, and not the helper that falls back to it.
        expect(handler).not.toContain(`"x-forwarded-for"`)
        expect(handler).not.toContain("getClientIp")
        expect(handler).not.toContain("x-real-ip")
    })

    it("is settled before anything a terminal sent is read", () => {
        const refusedElsewhere = handler.indexOf("!ipInRanges(address, terminal.allowedAddresses)")
        const held = handler.indexOf("if (terminal.refused) return refuse(403)")
        const body = handler.indexOf("await req.text()")
        expect(refusedElsewhere).toBeGreaterThan(-1)
        expect(held).toBeGreaterThan(refusedElsewhere)
        expect(body).toBeGreaterThan(held)
        // The body is read in one place: for attendance records.
        expect(handler.match(/req\.(text|json|formData|arrayBuffer|blob)\(\)/g)).toEqual(["req.text()"])
    })

    it("moves a terminal on only once what it sent is taken", () => {
        const taken = handler.indexOf("await AttendanceTerminalPushService.receive(terminal.deviceId, lines, address)")
        const movedOn = handler.indexOf("kept => cursorWith(kept, { scans: stamp })")
        expect(taken).toBeGreaterThan(-1)
        expect(movedOn).toBeGreaterThan(taken)
    })

    it("moves one log on beside the other's place as the terminal's row holds it then, with the row held", () => {
        // Never from what the request read when it arrived: uploads of both logs at once would undo one another's.
        expect(handler).not.toContain("cursorWith(terminal.cursor")
        expect(handler).toContain("kept => cursorWith(kept, { people: stamp })")
        const push = source("lib/services/attendance-terminal-push.service.ts")
        const gotTo = push.slice(push.indexOf("static async gotTo("), push.indexOf("static async receive("))
        expect(gotTo).toContain(`WHERE id = \${deviceId} AND "connection" = 'DIRECT' AND "retiredAt" IS NULL FOR NO KEY UPDATE`)
        expect(gotTo).toContain("data: { pushCursor: moved(held[0].pushCursor) }")
        // One after the other on the transaction, and nothing written outside it.
        expect(gotTo).not.toContain("Promise.all")
        expect(gotTo).not.toContain("prisma.attendanceDevice")
    })

    it("has the limits a Hikvision terminal has, and notes a call from elsewhere once an hour", () => {
        expect([UNKNOWN_PER_ADDRESS, PER_TERMINAL_PER_MINUTE]).toEqual([30, 600])
        expect(ELSEWHERE_NOTED_EVERY_MS).toBe(60 * 60_000)
        expect(handler).toContain("`terminal-unknown:${address}`, UNKNOWN_PER_ADDRESS, UNKNOWN_WINDOW_MS")
        expect(handler).toContain("`terminal:${terminal.deviceId}`, PER_TERMINAL_PER_MINUTE, 60_000")
        expect(handler).toContain("`terminal-elsewhere:${terminal.deviceId}`, 1, ELSEWHERE_NOTED_EVERY_MS")
    })

    it("sends no command, ever", () => {
        // A command is a line that starts "C:" (§17.11): nothing here writes one.
        for (const file of ["lib/attendance/zkteco-handler.ts", "lib/attendance/zkteco-adms.ts"]) expect(source(file), file).not.toMatch(/["'`]C:/)
    })
})

describe("once a ZKTeco terminal can be added straight to Nizmo (PR 297)", () => {
    it("the addresses answer one added that way, where the Super Admin has turned it on for its company", () => {
        expect(CONNECTIONS_BUILT.ZKTECO).toEqual(["AGENT", "DIRECT"])
        expect(mayConnect("ZKTECO", "DIRECT", true)).toBe(true)
        expect(mayConnect("ZKTECO", "DIRECT", false)).toBe(false)
    })

    it("no migration comes with them: the columns came with part 4, and the index that finds a terminal with the agent", () => {
        const part4 = readFileSync("prisma/migrations/20261229000000_terminal_connection/migration.sql", "utf8")
        for (const column of [`"allowedAddresses"`, `"pushCursor"`, `"lastAddress"`, `"refusedCount"`]) expect(part4, column).toContain(column)
        expect(readFileSync("prisma/migrations/20261018000000_attendance_terminals/migration.sql", "utf8"))
            .toContain(`CREATE UNIQUE INDEX "AttendanceDevice_serialNumber_active_key" ON "AttendanceDevice"("serialNumber") WHERE "retiredAt" IS NULL;`)
    })
})
