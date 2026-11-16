import { describe, it, expect } from "vitest"
import { admsRequest, attlogOf, type AdmsRequest } from "./zkteco-adms"
import { MAX_KEPT_BODY } from "./terminal-first-contact"
import { admsContact, admsKind, admsOutcome, admsRequestLine, notOpened, scansKept } from "./zkteco-first-contact"

/**
 * What is kept of a ZKTeco terminal's first requests (ATTENDANCE_PLAN.md
 * §17.8, Phase 4 part 6, PR 299): what kind of request it was, its request
 * line, what of its body, and what Nizmo made of it. Only scans are
 * opened: what else a terminal sends carries names, pictures and
 * fingerprints. What is stored, and when, is in
 * lib/terminal-adms-first-contacts.db.test.ts.
 */

const url = (path: string) => new URL(`https://nizmo.example${path}`)
const asked = (method: string, path: string) => admsRequest(method, url(path)) as AdmsRequest
const kind = (method: string, path: string) => admsKind(asked(method, path), method, url(path))
const line = (path: string) => admsRequestLine(url(path))

describe("a request's kind", () => {
    it("is what the request is, known from its address before anything it sent is read", () => {
        expect(kind("GET", "/iclock/cdata?SN=ABC123&options=all&pushver=2.4.1")).toBe("options")
        expect(kind("GET", "/iclock/cdata.aspx?SN=ABC123&options=all")).toBe("options")
        expect(kind("POST", "/iclock/cdata?SN=ABC123&table=ATTLOG&Stamp=9")).toBe("ATTLOG")
        // The 2.0.1 document's own uploads name no table.
        expect(kind("POST", "/iclock/cdata?SN=ABC123&Stamp=9")).toBe("ATTLOG")
        expect(kind("POST", "/iclock/cdata?SN=ABC123&table=OPERLOG&OpStamp=3")).toBe("OPERLOG")
        expect(kind("POST", "/iclock/cdata?SN=ABC123&OpStamp=3")).toBe("OPERLOG")
        expect(kind("GET", "/iclock/getrequest?SN=ABC123&INFO=Ver%208.0,1,0,2,192.0.2.10")).toBe("getrequest")
    })

    it("is anything else by its method, its path under /iclock/ and the table it names", () => {
        expect(kind("POST", "/iclock/cdata?SN=ABC123&table=ATTPHOTO&Stamp=1")).toBe("POST cdata table=ATTPHOTO")
        expect(kind("POST", "/iclock/cdata?SN=ABC123&table=userinfo")).toBe("POST cdata table=USERINFO")
        expect(kind("POST", "/iclock/devicecmd?SN=ABC123")).toBe("POST devicecmd")
        expect(kind("GET", "/iclock/cdata?SN=ABC123&type=time")).toBe("GET cdata")
        expect(kind("GET", "/iclock/ping?SN=ABC123")).toBe("GET ping")
        expect(kind("POST", "/iclock/Registry.aspx?SN=ABC123")).toBe("POST registry.aspx")
        expect(kind("GET", "/iclock/a/b?SN=ABC123")).toBe("GET a/b")
    })

    it("holds nothing it shouldn't, and is short", () => {
        expect(kind("POST", "/iclock/cdata?SN=ABC123&table=<b>x</b>%20y")).toBe("POST cdata table=BXBY")
        expect(kind("POST", `/iclock/${"x".repeat(200)}?SN=ABC123&table=${"T".repeat(200)}`).length).toBeLessThanOrEqual(120)
    })
})

describe("its request line", () => {
    it("is its path under /iclock/ and its query as it came, a parameter at a time, in the order sent", () => {
        expect(line("/iclock/cdata?SN=ABC123&options=all&pushver=2.4.1&language=69")).toBe("/iclock/cdata?SN=ABC123&options=all&pushver=2.4.1&language=69")
        expect(line("/iclock/cdata?SN=ABC123&table=ATTLOG&Stamp=9999")).toBe("/iclock/cdata?SN=ABC123&table=ATTLOG&Stamp=9999")
        expect(line("/iclock/cdata?Stamp=12&OpStamp=3&PhotoStamp=0&SN=ABC123")).toBe("/iclock/cdata?Stamp=12&OpStamp=3&PhotoStamp=0&SN=ABC123")
        expect(line("/iclock/getrequest?SN=ABC123")).toBe("/iclock/getrequest?SN=ABC123")
        expect(line("/iclock/getrequest")).toBe("/iclock/getrequest")
    })

    it("keeps the values of the parameters the protocol names, whatever their case", () => {
        const kept = line("/iclock/cdata?sn=ABC123&OPTIONS=all&PushOptionsFlag=1&DeviceType=att&type=time&tablename=ATTLOG&count=3&ATTLOGStamp=1&OPERLOGStamp=2&ATTPHOTOStamp=3")
        expect(kept).toBe("/iclock/cdata?sn=ABC123&OPTIONS=all&PushOptionsFlag=1&DeviceType=att&type=time&tablename=ATTLOG&count=3&ATTLOGStamp=1&OPERLOGStamp=2&ATTPHOTOStamp=3")
    })

    it("keeps any other parameter by its name alone: a later firmware's could carry something drawn from the comm key", () => {
        expect(line("/iclock/cdata?SN=ABC123&options=all&pushcommkey=0f1e2d3c4b5a")).toBe("/iclock/cdata?SN=ABC123&options=all&pushcommkey=[removed, 12 characters]")
        expect(line("/iclock/cdata?SN=ABC123&name=Ehab%20Hassan&empty=")).toBe("/iclock/cdata?SN=ABC123&name=[removed, 11 characters]&empty=")
    })

    it("takes the terminal's address on the office network out of INFO, and keeps its firmware and counts", () => {
        const info = encodeURIComponent("Ver 8.0.4.2-20230101,25,3,1532,192.168.1.201,10,1,7,100")
        expect(line(`/iclock/getrequest?SN=ABC123&INFO=${info}`)).toBe("/iclock/getrequest?SN=ABC123&INFO=Ver 8.0.4.2-20230101,25,3,1532,[address removed],10,1,7,100")
        // Wherever it is after the firmware, and whichever kind of address.
        expect(line(`/iclock/getrequest?SN=ABC123&INFO=${encodeURIComponent("Ver 6.60,25,3,1532,fe80::1a2b,10.0.0.7")}`)).toBe("/iclock/getrequest?SN=ABC123&INFO=Ver 6.60,25,3,1532,[address removed],[address removed]")
        expect(line(`/iclock/getrequest?SN=ABC123&INFO=${encodeURIComponent("Ver 6.60,25,3,1532, 192.168.1.201 ")}`)).toBe("/iclock/getrequest?SN=ABC123&INFO=Ver 6.60,25,3,1532,[address removed]")
    })

    it("cuts what is long, and leaves out what can't be shown", () => {
        expect(line(`/iclock/cdata?SN=ABC123&Stamp=${"9".repeat(150)}`)).toBe(`/iclock/cdata?SN=ABC123&Stamp=${"9".repeat(100)} … [cut: 150 characters in all]`)
        expect(line("/iclock/cdata?SN=ABC123&type=a%0Ab%00c")).toBe("/iclock/cdata?SN=ABC123&type=a b c")
        expect(line(`/iclock/cdata?SN=ABC123&${Array.from({ length: 50 }, (_, i) => `p${i}=1`).join("&")}`).length).toBeLessThanOrEqual(1_000)
        expect(line(`/iclock/${"x".repeat(500)}?SN=ABC123`).length).toBeLessThanOrEqual(1_000)
        expect(line("/iclock/cdata?SN=ABC123&<script>=1")).toBe("/iclock/cdata?SN=ABC123&?script?=[removed, 1 characters]")
    })
})

describe("the scans it sends, the one body opened", () => {
    it("keeps each line as it came, tabs and all: employee number, date and time, and the short numbers beside them", () => {
        expect(scansKept("7\t2026-11-16 08:01:02\t0\t1\t0\n")).toBe("7\t2026-11-16 08:01:02\t0\t1\t0")
        expect(scansKept("7\t2026-11-16 08:01:02\t0\t1\t0\r\n8\t2026-11-16 08:02:00\t1\t15\t0\r\n")).toBe("7\t2026-11-16 08:01:02\t0\t1\t0\n8\t2026-11-16 08:02:00\t1\t15\t0")
        // Where the tabs were lost, the spaces are kept as they came.
        expect(scansKept("7 2026-11-16 08:01:02 0 1")).toBe("7 2026-11-16 08:01:02 0 1")
        expect(scansKept("7\t2026-11-16T08:01:02\t0")).toBe("7\t2026-11-16T08:01:02\t0")
    })

    it("keeps an employee number however long, as the punch does", () => {
        expect(scansKept("100234567\t2026-11-16 08:01:02\t0\t1")).toBe("100234567\t2026-11-16 08:01:02\t0\t1")
    })

    it("replaces anything else on a scan's line with a note of what was there", () => {
        expect(scansKept("7\t2026-11-16 08:01:02\t0\t1\t0\t0\t1234567890\tabc")).toBe("7\t2026-11-16 08:01:02\t0\t1\t0\t0\t[removed, 10 characters]\t[removed, 3 characters]")
    })

    it("reads a line that isn't a scan by the rules for text that is neither JSON nor XML: no name, and no long number", () => {
        expect(scansKept("PIN=7\tName=Ehab Hassan\tCard=12345678")).toBe("PIN=7\tName=[name removed]")
        expect(scansKept("USER 1234567890")).toBe("USER [number removed]")
        expect(scansKept(`7\t${"x".repeat(900)}`).length).toBeLessThan(700)
    })

    it("reads such a line as unreadable text whatever its shape: as JSON or XML too, it keeps no long number (review on PR 299)", () => {
        for (const line of ['{"employee":7,"credential":1234567890}', "[7, 1234567890]", "<Event><credential>1234567890</credential></Event>", '<EventNotificationAlert><credential>1234567890</credential></EventNotificationAlert>']) {
            const kept = scansKept(line)
            expect(kept, line).not.toContain("1234567890")
            expect(kept, line).toContain("[number removed]")
        }
        // A name is still taken out by its field's name.
        expect(scansKept('{"name":"Ehab Hassan","employee":7}')).not.toContain("Ehab")
    })

    it("is cut at 8,000 characters, saying how many lines there were", () => {
        const many = Array.from({ length: 1_000 }, (_, i) => `${i}\t2026-11-16 08:01:02\t0\t1\t0`).join("\n")
        const kept = scansKept(many)
        expect(kept.length).toBeLessThanOrEqual(MAX_KEPT_BODY + 40)
        expect(kept.endsWith("… [cut: 1,000 lines in all]")).toBe(true)
        expect(kept.startsWith("0\t2026-11-16 08:01:02\t0\t1\t0\n1\t")).toBe(true)
        // Whole lines only.
        expect(kept.split("\n").at(-2)).toMatch(/^\d+\t2026-11-16 08:01:02\t0\t1\t0$/)
    })

    it("is nothing for an upload with no lines", () => {
        expect(scansKept("")).toBe("")
        expect(scansKept("\r\n\n")).toBe("")
    })
})

describe("what isn't opened", () => {
    const headers = (h: Record<string, string>) => new Headers(h)

    it("says so in place of the body: changes to the people it holds carry their names", () => {
        expect(notOpened(asked("POST", "/iclock/cdata?SN=ABC123&table=OPERLOG&OpStamp=3"), "POST", headers({ "content-length": "120" }))).toBe("[not opened: changes to the people it holds carry their names]")
        expect(notOpened(asked("POST", "/iclock/cdata?SN=ABC123&table=ATTPHOTO"), "POST", headers({ "content-length": "40000" }))).toBe("[not opened: what isn't a scan can carry names, pictures or fingerprints]")
        expect(notOpened(asked("POST", "/iclock/devicecmd?SN=ABC123"), "POST", headers({ "transfer-encoding": "chunked" }))).toBe("[not opened: what isn't a scan can carry names, pictures or fingerprints]")
        // Nothing says how long it is: it might have one.
        expect(notOpened(asked("POST", "/iclock/devicecmd?SN=ABC123"), "POST", headers({}))).toBe("[not opened: what isn't a scan can carry names, pictures or fingerprints]")
    })

    it("is nothing where nothing was sent", () => {
        expect(notOpened(asked("POST", "/iclock/cdata?SN=ABC123&table=OPERLOG"), "POST", headers({ "content-length": "0" }))).toBe("")
        expect(notOpened(asked("GET", "/iclock/getrequest?SN=ABC123"), "GET", headers({}))).toBe("")
        expect(notOpened(asked("GET", "/iclock/cdata?SN=ABC123&options=all"), "GET", headers({}))).toBe("")
    })
})

describe("what Nizmo made of it", () => {
    const stored = (s: Partial<{ accepted: number; duplicates: number; skipped: number; refused: { reason: string }[] }> = {}) => ({ accepted: 0, duplicates: 0, skipped: 0, refused: [], ...s })

    it("answered its options, or had nothing to keep of its heartbeat", () => {
        expect(admsOutcome(asked("GET", "/iclock/cdata?SN=ABC123&options=all"), false, null, null)).toEqual(["OPTIONS"])
        expect(admsOutcome(asked("GET", "/iclock/getrequest?SN=ABC123"), false, null, null)).toEqual(["NOTHING"])
    })

    it("stored its scans, found them already there or from before, or refused them and why", () => {
        const scans = asked("POST", "/iclock/cdata?SN=ABC123&table=ATTLOG&Stamp=9")
        expect(admsOutcome(scans, true, attlogOf("7\t2026-11-16 08:01:02\t0\t1"), stored({ accepted: 1 }))).toEqual(["STORED"])
        expect(admsOutcome(scans, true, attlogOf("7\t2026-11-16 08:01:02\t0\t1\nx"), stored({ duplicates: 1 }))).toEqual(["ALREADY", "REFUSED:UNREADABLE"])
        expect(admsOutcome(scans, true, attlogOf("7\t2026-11-16 08:01:02"), stored({ skipped: 1, refused: [{ reason: "UNMAPPED" }] }))).toEqual(["SKIPPED", "REFUSED:UNMAPPED"])
        expect(admsOutcome(scans, true, attlogOf(`${"9".repeat(33)}\t2026-11-16 08:01:02`), null)).toEqual(["REFUSED:INVALID_NUMBER"])
        // An upload with no lines had nothing to keep: not the empty test a Hikvision terminal sends.
        expect(admsOutcome(scans, false, [], null)).toEqual(["NOTHING"])
    })

    it("didn't open what isn't a scan, and had nothing to keep where nothing came", () => {
        expect(admsOutcome(asked("POST", "/iclock/cdata?SN=ABC123&table=OPERLOG"), true, null, null)).toEqual(["NOT_OPENED"])
        expect(admsOutcome(asked("POST", "/iclock/cdata?SN=ABC123&table=OPERLOG"), false, null, null)).toEqual(["NOTHING"])
        expect(admsOutcome(asked("POST", "/iclock/cdata?SN=ABC123&table=ATTPHOTO"), true, null, null)).toEqual(["NOT_OPENED"])
        expect(admsOutcome(asked("GET", "/iclock/ping?SN=ABC123"), false, null, null)).toEqual(["NOTHING"])
    })
})

describe("a whole request, kept", () => {
    const request = (method: string, path: string, headers: Record<string, string> = {}, body?: string) =>
        new Request(`https://nizmo.example${path}`, { method, headers: { "user-agent": "iClock Proxy/1.09", "x-vercel-forwarded-for": "198.51.100.7", ...headers }, body })

    it("a heartbeat: its line without the office network's address, how it speaks, and the hosting's headers by name alone", () => {
        const path = `/iclock/getrequest?SN=ABC123&INFO=${encodeURIComponent("Ver 8.0.4.2,25,3,1532,192.168.1.201")}`
        const req = request("GET", path, { cookie: "a=b", authorization: "Basic eHh4" })
        const kept = admsContact(req, url(path), asked("GET", path), {})
        expect(kept).toEqual({
            method: "GET",
            path: "/iclock/getrequest?SN=ABC123&INFO=Ver 8.0.4.2,25,3,1532,[address removed]",
            headers: { "user-agent": "iClock Proxy/1.09", cookie: "[removed]", authorization: "Basic [removed]" },
            otherHeaders: ["x-vercel-forwarded-for"],
            body: "",
            kind: "getrequest",
            outcome: ["NOTHING"],
        })
        // The office's own internet address is nowhere in it.
        expect(JSON.stringify(kept)).not.toContain("198.51.100.7")
        expect(JSON.stringify(kept)).not.toContain("192.168.1.201")
    })

    it("scans: their lines, and what became of them", () => {
        const path = "/iclock/cdata?SN=ABC123&table=ATTLOG&Stamp=9999"
        const text = "7\t2026-11-16 08:01:02\t0\t1\t0\t0\t1234567890\n"
        const lines = attlogOf(text)
        const kept = admsContact(request("POST", path, { "content-type": "text/plain", "content-length": String(text.length) }, text), url(path), asked("POST", path), { text, lines, stored: { accepted: 1, duplicates: 0, skipped: 0, refused: [] } })
        expect(kept).toMatchObject({
            method: "POST", path, headers: { "content-type": "text/plain", "content-length": String(text.length) },
            body: "7\t2026-11-16 08:01:02\t0\t1\t0\t0\t[removed, 10 characters]", kind: "ATTLOG", outcome: ["STORED"],
        })
    })

    it("changes to the people it holds: never opened, only said so", () => {
        const path = "/iclock/cdata?SN=ABC123&table=OPERLOG&OpStamp=3"
        const body = "USER PIN=7\tName=Ehab Hassan\tPri=0\tPasswd=1234\tCard=[0012345678]"
        const kept = admsContact(request("POST", path, { "content-length": String(body.length) }, body), url(path), asked("POST", path), {})
        expect(kept).toMatchObject({ body: "[not opened: changes to the people it holds carry their names]", kind: "OPERLOG", outcome: ["NOT_OPENED"] })
        expect(JSON.stringify(kept)).not.toMatch(/Ehab|1234|0012345678/)
    })

    it("its first call: answered with its options", () => {
        const path = "/iclock/cdata?SN=ABC123&options=all&pushver=2.4.1&language=69"
        expect(admsContact(request("GET", path), url(path), asked("GET", path), {})).toMatchObject({ path, body: "", kind: "options", outcome: ["OPTIONS"] })
    })
})
