import { describe, it, expect } from "vitest"
import { CONNECTIONS_BUILT, addressLines, connectionChoices, hasAddress, hasOfficeAddress, hikvisionPath, hikvisionSettings, mayConnect, refusalWords, zktecoSettings } from "./terminal-connections"
import { isPushSecret, newPushSecret, withoutTerminalSecrets, HIKVISION_ROUTE } from "./terminal-secrets"
import { en } from "../translations/en"
import { ar } from "../translations/ar"

/**
 * How a terminal added by hand connects (ATTENDANCE_PLAN.md §17.1, §17.7,
 * PR 292, PR 297): the ways listed, the ones built, what to set on a
 * terminal straight to Nizmo, the office's address a ZKTeco one is let in
 * from, and the words for a refusal.
 */

describe("the ways a terminal connects", () => {
    it("are either way for ZKTeco's, and straight to Nizmo for Hikvision's", () => {
        // Part 6 (PR 297) added ZKTeco's straight to Nizmo; part 7 (§20) adds the agent for Hikvision's.
        expect(CONNECTIONS_BUILT).toEqual({ ZKTECO: ["AGENT", "DIRECT"], HIKVISION: ["DIRECT"] })
    })

    it("list straight to Nizmo only where the Super Admin has turned it on for the company", () => {
        expect(connectionChoices("ZKTECO", false)).toEqual([{ connection: "AGENT", built: true }])
        expect(connectionChoices("HIKVISION", false)).toEqual([{ connection: "AGENT", built: false }])
        expect(connectionChoices("ZKTECO", true)).toEqual([{ connection: "AGENT", built: true }, { connection: "DIRECT", built: true }])
        expect(connectionChoices("HIKVISION", true)).toEqual([{ connection: "AGENT", built: false }, { connection: "DIRECT", built: true }])
    })

    it("can be picked only when listed and built", () => {
        expect(mayConnect("ZKTECO", "AGENT", false)).toBe(true)
        expect(mayConnect("ZKTECO", "AGENT", true)).toBe(true)
        expect(mayConnect("ZKTECO", "DIRECT", true)).toBe(true)
        expect(mayConnect("HIKVISION", "DIRECT", true)).toBe(true)
        // Built, but not this company's to pick: its switch is off.
        expect(mayConnect("ZKTECO", "DIRECT", false)).toBe(false)
        expect(mayConnect("HIKVISION", "DIRECT", false)).toBe(false)
        expect(mayConnect("HIKVISION", "AGENT", false)).toBe(false)
        expect(mayConnect("HIKVISION", "AGENT", true)).toBe(false)
    })

    it("give an address of its own to a Hikvision terminal straight to Nizmo, and no other", () => {
        expect(hasAddress({ protocol: "HIKVISION", connection: "DIRECT" })).toBe(true)
        expect(hasAddress({ protocol: "HIKVISION", connection: "AGENT" })).toBe(false)
        expect(hasAddress({ protocol: "ZKTECO", connection: "DIRECT" })).toBe(false)
        expect(hasAddress({ protocol: "ZKTECO", connection: "AGENT" })).toBe(false)
    })

    it("let a ZKTeco terminal straight to Nizmo in from its office's address, and ask no other for one", () => {
        expect(hasOfficeAddress({ protocol: "ZKTECO", connection: "DIRECT" })).toBe(true)
        expect(hasOfficeAddress({ protocol: "ZKTECO", connection: "AGENT" })).toBe(false)
        expect(hasOfficeAddress({ protocol: "HIKVISION", connection: "DIRECT" })).toBe(false)
        expect(hasOfficeAddress({ protocol: "HIKVISION", connection: "AGENT" })).toBe(false)
    })
})

describe("the office's address, as typed", () => {
    it("is one entry a line, or several on one with commas, each trimmed, the empty ones dropped", () => {
        expect(addressLines("203.0.113.7")).toEqual(["203.0.113.7"])
        expect(addressLines(" 203.0.113.7 \n\n198.51.100.0/28\r\n")).toEqual(["203.0.113.7", "198.51.100.0/28"])
        expect(addressLines("203.0.113.7, 2001:db8::1")).toEqual(["203.0.113.7", "2001:db8::1"])
        expect(addressLines("  \n , ")).toEqual([])
    })

    it("is checked by the server alone: what is typed is sent as it is, line by line", () => {
        // Whether an entry is an address is the server's to say (lib/attendance/ip-ranges.ts), not the page's.
        expect(addressLines("not an address")).toEqual(["not an address"])
    })
})

describe("what to set on a ZKTeco terminal", () => {
    it("is four settings under its Cloud Server Setting's names: Nizmo's own address to copy, port 443, domain name and HTTPS on", () => {
        expect(zktecoSettings("nizmo.example")).toEqual([
            { name: "Server address", value: "nizmo.example", copy: true },
            { name: "Server port", value: "443", copy: false },
            { name: "Enable domain name", value: "ON", copy: false },
            { name: "HTTPS", value: "ON", copy: false },
        ])
    })

    it("has nothing secret in it", () => {
        const values = zktecoSettings("nizmo.example").map(s => s.value).join(" ")
        expect(values).not.toMatch(/\/api\/terminals/)
        expect(values).not.toMatch(/[A-Za-z0-9_-]{32,}/)
    })
})

describe("what to set on a Hikvision terminal", () => {
    it("is the route it sends to, with its secret where the pattern has it", () => {
        const secret = newPushSecret()
        const path = hikvisionPath(secret)
        expect(path).toBe(`/api/terminals/hikvision/${secret}`)
        expect(isPushSecret(path.split("/").pop()!)).toBe(true)
        // The same address, written down, loses its secret (PR 291).
        expect(withoutTerminalSecrets(path)).toBe(HIKVISION_ROUTE)
    })

    it("is four settings: Nizmo's own address and the path to copy, port 443 and HTTPS", () => {
        expect(hikvisionSettings("nizmo.example", "/api/terminals/hikvision/abc")).toEqual([
            { name: "Destination IP or domain name", value: "nizmo.example", copy: true },
            { name: "URL", value: "/api/terminals/hikvision/abc", copy: true },
            { name: "Port", value: "443", copy: false },
            { name: "Protocol", value: "HTTPS", copy: false },
        ])
    })
})

describe("why a terminal's own scan was refused", () => {
    // Every reason the ingest and the receiving route keep on a terminal (§17.5, PR 290, PR 291).
    const KEPT = ["MONTH_LOCKED", "INVALID_TIME", "IN_FUTURE", "DEVICE_RETIRED", "DEVICE_VIA_AGENT", "DIRECT_NOT_ALLOWED", "INVALID_NUMBER", "UNREADABLE"]

    it("has words in both languages for every reason kept", () => {
        for (const reason of KEPT) {
            const words = refusalWords(reason)
            expect(words, reason).toEqual({ key: `att_term_refusal_${reason}` })
            expect((en as Record<string, string>)[words!.key], reason).toBeTruthy()
            expect((ar as Record<string, string>)[words!.key], reason).toBeTruthy()
        }
    })

    it("names the type of an event on neither list", () => {
        expect(refusalWords("EVENT_NOT_KNOWN:113")).toEqual({ key: "att_term_refusal_EVENT_NOT_KNOWN", type: "113" })
        expect(refusalWords("EVENT_NOT_KNOWN:?")).toEqual({ key: "att_term_refusal_EVENT_NOT_KNOWN", type: "?" })
        expect(en.att_term_refusal_EVENT_NOT_KNOWN).toContain("{type}")
        expect(ar.att_term_refusal_EVENT_NOT_KNOWN).toContain("{type}")
    })

    it("names the address a call in a terminal's name came from, which isn't the office's", () => {
        expect(refusalWords("ADDRESS_NOT_ALLOWED:198.51.100.9")).toEqual({ key: "att_term_refusal_ADDRESS_NOT_ALLOWED", address: "198.51.100.9" })
        expect(refusalWords("ADDRESS_NOT_ALLOWED:2001:db8::7")).toEqual({ key: "att_term_refusal_ADDRESS_NOT_ALLOWED", address: "2001:db8::7" })
        expect(en.att_term_refusal_ADDRESS_NOT_ALLOWED).toContain("{address}")
        expect(ar.att_term_refusal_ADDRESS_NOT_ALLOWED).toContain("{address}")
    })

    it("has none for a reason it doesn't know, which is shown as it was kept", () => {
        expect(refusalWords("SOMETHING_NEW")).toBeNull()
        expect(refusalWords("")).toBeNull()
    })

    it("covers the reasons the server writes", async () => {
        const { readFileSync } = await import("node:fs")
        const ingest = readFileSync("lib/services/attendance-ingest.service.ts", "utf8")
        const events = readFileSync("lib/attendance/hikvision-events.ts", "utf8")
        const push = readFileSync("lib/services/attendance-terminal-push.service.ts", "utf8")
        for (const reason of KEPT) expect(ingest + events + push, reason).toContain(`"${reason}"`)
        // A call from elsewhere, with its address (PR 296).
        expect(push).toContain("lastRefusal: `ADDRESS_NOT_ALLOWED:${")
    })
})
