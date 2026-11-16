import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { X509Certificate } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer as createNetServer, type AddressInfo, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { digestAuthorization, parseChallenge } from "../src/hik/digest"
import { HikClient, HikError } from "../src/hik/client"
import { PASSED_CHECKS, pickNew, type HikEvent } from "../src/hik/events"
import { PASSED_CHECKS as NIZMO_PASSED_CHECKS } from "../../lib/attendance/hikvision-events"
import { FakeHikDevice, type FakeHikEvent } from "./fake-hik-device"
import { selfSigned } from "./tls"

/**
 * The agent's Hikvision client (ATTENDANCE_PLAN.md §17.4, Phase 4 part 7,
 * PR 300): digest authentication, checked against RFC 7616's own example;
 * what it reads of a terminal, against a simulated one that checks every
 * signature; where it had got to; and HTTPS with the terminal's certificate
 * pinned. Nothing in the agent uses it yet.
 */

describe("digest authentication", () => {
    // RFC 7616 §3.9.1, its example worked through, MD5 and SHA-256 alike.
    const challenge = (algorithm: string) => parseChallenge(`Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=${algorithm}, nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"`)!
    const sign = (algorithm: string) => digestAuthorization({
        challenge: challenge(algorithm), user: "Mufasa", password: "Circle of Life", method: "GET", uri: "/dir/index.html", nc: 1, cnonce: "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ",
    })

    it("signs as RFC 7616's example does, with MD5 and with SHA-256", () => {
        expect(sign("MD5")).toContain('response="8ca523f5e9506fed4657c9700eebdbec"')
        expect(sign("SHA-256")).toContain('response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1"')
    })

    it("names everything the terminal checks, and never the password", () => {
        const header = sign("MD5")
        expect(header.startsWith("Digest ")).toBe(true)
        for (const part of ['username="Mufasa"', 'realm="http-auth@example.org"', 'uri="/dir/index.html"', "qop=auth", "nc=00000001",
            'cnonce="f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ"', 'opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"', "algorithm=MD5"]) expect(header).toContain(part)
        expect(header).not.toContain("Circle of Life")
    })

    it("reads a challenge however it is written, MD5 when it names no algorithm", () => {
        expect(parseChallenge('Digest qop="auth",realm="DS-K1T341AM",nonce="abc",stale=TRUE')).toEqual({ realm: "DS-K1T341AM", nonce: "abc", opaque: null, algorithm: "MD5", qop: "auth", stale: true })
        expect(parseChallenge('Digest realm="r", nonce="n", algorithm=SHA-256, qop="auth-int,auth"')).toMatchObject({ algorithm: "SHA-256", qop: "auth", stale: false })
        // What it can't answer: another scheme, no nonce, an algorithm it doesn't know, or no qop of auth.
        expect(parseChallenge('Basic realm="r"')).toBeNull()
        expect(parseChallenge('Digest realm="r"')).toBeNull()
        expect(parseChallenge('Digest realm="r", nonce="n", algorithm=SHA-512-256, qop="auth"')).toBeNull()
        expect(parseChallenge('Digest realm="r", nonce="n", qop="auth-int"')).toBeNull()
    })
})

describe("which events are new", () => {
    const event = (serialNo: number, time: string, minor = 0x4b, employee: string | undefined = "7"): HikEvent => ({ major: 5, minor, time, serialNo, employeeNoString: employee })

    it("keeps every passed check the first time, and moves to the last event", () => {
        const { records, cursor } = pickNew([event(1, "2026-11-16T09:00:00+02:00"), event(2, "2026-11-16T09:01:00+02:00", 0x26, "8")], null)
        expect(records).toEqual([{ userNumber: "7", at: "2026-11-16T09:00:00" }, { userNumber: "8", at: "2026-11-16T09:01:00" }])
        expect(cursor).toEqual({ serialNo: 2, time: "2026-11-16T09:01:00+02:00" })
    })

    it("keeps only the events past where it had got to, by the terminal's own numbering", () => {
        const events = [event(4, "2026-11-16T09:00:00+02:00"), event(5, "2026-11-16T09:00:00+02:00"), event(6, "2026-11-16T09:00:00+02:00", 0x4b, "9")]
        const { records, cursor } = pickNew(events, { serialNo: 5, time: "2026-11-16T09:00:00+02:00" })
        expect(records).toEqual([{ userNumber: "9", at: "2026-11-16T09:00:00" }])
        expect(cursor).toEqual({ serialNo: 6, time: "2026-11-16T09:00:00+02:00" })
    })

    it("moves past what isn't a passed check, and keeps none of it", () => {
        // A door left open, a failed attempt, a card issued to nobody, and a time it can't read.
        const events = [event(10, "2026-11-16T09:00:00+02:00", 0x15), event(11, "2026-11-16T09:01:00+02:00", 0x27), event(12, "2026-11-16T09:02:00+02:00", 0x01, ""), event(13, "now", 0x4b)]
        expect(pickNew(events, null)).toEqual({ records: [], cursor: { serialNo: 13, time: "now" } })
    })

    it("keeps where it was when there is nothing at all", () => {
        expect(pickNew([], { serialNo: 9, time: "2026-11-16T09:00:00+02:00" })).toEqual({ records: [], cursor: { serialNo: 9, time: "2026-11-16T09:00:00+02:00" } })
        expect(pickNew([], null)).toEqual({ records: [], cursor: null })
    })

    it("reads a log cleared or restarted from the cursor's time on, when every event is numbered below it", () => {
        const events = [event(1, "2026-11-16T08:00:00+02:00", 0x4b, "5"), event(2, "2026-11-16T10:00:00+02:00", 0x4b, "6"), event(3, "2026-11-16T10:05:00+02:00", 0x4b, "7")]
        const { records, cursor } = pickNew(events, { serialNo: 900, time: "2026-11-16T10:00:00+02:00" })
        expect(records.map(r => r.userNumber)).toEqual(["6", "7"])
        expect(cursor).toEqual({ serialNo: 3, time: "2026-11-16T10:05:00+02:00" })
    })

    it("reads a log cleared and refilled up to the cursor's number as cleared, by the cursor's own event", () => {
        // Cleared at 10:30: its new events are numbered 1 and 2 again, and 2 isn't the event the cursor was.
        const events = [event(1, "2026-11-16T11:00:00+02:00", 0x4b, "5"), event(2, "2026-11-16T11:05:00+02:00", 0x4b, "6")]
        const { records, cursor } = pickNew(events, { serialNo: 2, time: "2026-11-16T10:00:00+02:00" })
        expect(records.map(r => r.userNumber)).toEqual(["5", "6"])
        expect(cursor).toEqual({ serialNo: 2, time: "2026-11-16T11:05:00+02:00" })
        // The cursor's own event found again, written with another offset, is the same event: nothing new.
        expect(pickNew([event(2, "2026-11-16T09:00:00+01:00")], { serialNo: 2, time: "2026-11-16T10:00:00+02:00" }).records).toEqual([])
    })

    it("takes the employee number as a number where its text is empty, as Nizmo does", () => {
        const events: HikEvent[] = [
            { major: 5, minor: 0x4b, time: "2026-11-16T09:00:00+02:00", serialNo: 1, employeeNoString: " ", employeeNo: 105 },
            { major: 5, minor: 0x4b, time: "2026-11-16T09:01:00+02:00", serialNo: 2, employeeNoString: "", employeeNo: " 106 " },
            { major: 5, minor: 0x4b, time: "2026-11-16T09:02:00+02:00", serialNo: 3, employeeNoString: " 107 ", employeeNo: 999 },
        ]
        expect(pickNew(events, null).records.map(r => r.userNumber)).toEqual(["105", "106", "107"])
    })

    it("counts as a passed check what Nizmo does when a terminal sends straight to it", () => {
        expect([...PASSED_CHECKS].sort((a, b) => a - b)).toEqual([...NIZMO_PASSED_CHECKS].sort((a, b) => a - b))
    })
})

describe("a terminal, read", () => {
    let device: FakeHikDevice
    afterEach(async () => { await device?.stop() })

    const at = (i: number) => new Date(Date.parse("2026-11-16T07:00:00Z") + i * 60_000)
    /** Events as a terminal keeps them: passed checks, with a failed attempt every tenth. */
    const events = (n: number, from = 1): FakeHikEvent[] => Array.from({ length: n }, (_, i) => {
        const wall = new Date(at(i + from).getTime() + 2 * 3_600_000).toISOString().slice(0, 19)
        return { major: 5, minor: (i + from) % 10 === 0 ? 0x27 : 0x4b, time: `${wall}+02:00`, serialNo: i + from, employeeNoString: String(100 + i + from), name: "Somebody" }
    })
    const client = (port: number, more: Partial<ConstructorParameters<typeof HikClient>[0]> = {}) =>
        new HikClient({ host: "127.0.0.1", port, user: "agent", password: "Correct Horse 9", ...more })

    it("says who it is, signing in with digest authentication, the password never sent", async () => {
        device = new FakeHikDevice()
        const port = await device.start()
        expect(await client(port).info()).toEqual({ serialNumber: "DS-K1T341AM0020201234", model: "DS-K1T341AM", name: "Lobby", firmware: "V3.2.30 build 220727" })
        // Asked once without signing, for the terminal's challenge, then signed.
        expect(device.seen.map(r => r.status)).toEqual([401, 200])
        expect(device.seen[1].authorization).toMatch(/^Digest /)
        for (const r of device.seen) expect(`${r.authorization} ${r.body}`).not.toContain("Correct Horse 9")
    })

    it("signs with SHA-256 where the terminal asks for it", async () => {
        device = new FakeHikDevice({ algorithm: "SHA-256" })
        const port = await device.start()
        expect((await client(port).info()).serialNumber).toBe("DS-K1T341AM0020201234")
        expect(device.seen.at(-1)?.authorization).toContain("algorithm=SHA-256")
    })

    it("reads its clock: its wall time and its offset from UTC, answering the same challenge again, counted on", async () => {
        device = new FakeHikDevice({ localTime: "2026-11-16T13:04:05+02:00" })
        const c = client(await device.start())
        expect(await c.clock()).toEqual({ wall: "2026-11-16T13:04:05", offsetMinutes: 120 })
        device.state.localTime = "2026-11-16T05:30:00-03:30"
        expect(await c.clock()).toEqual({ wall: "2026-11-16T05:30:00", offsetMinutes: -210 })
        // No second 401: the challenge it was given is answered again, its count moved on.
        expect(device.seen.map(r => r.status)).toEqual([401, 200, 200])
        expect(device.seen.at(-1)?.authorization).toContain("nc=00000002")
        device.state.localTime = "2026-11-16T05:30:00Z"
        expect(await c.clock()).toEqual({ wall: "2026-11-16T05:30:00", offsetMinutes: 0 })
        // A clock that states no offset says none.
        device.state.localTime = "2026-11-16T05:30:00"
        expect(await c.clock()).toEqual({ wall: "2026-11-16T05:30:00", offsetMinutes: null })
    })

    it("reads its passed checks a page at a time, and from where it had got to after that", async () => {
        device = new FakeHikDevice({ events: events(65), localTime: "2026-11-16T10:30:00+02:00" })
        const c = client(await device.start())
        const first = await c.passedChecks(null, "2026-11-16")
        // 65 events, 6 of them failed attempts: 59 scans, in the terminal's order, by wall time.
        expect(first.records).toHaveLength(59)
        expect(first.records[0]).toEqual({ userNumber: "101", at: "2026-11-16T09:01:00" })
        expect(first.cursor).toEqual({ serialNo: 65, time: events(65)[64].time })
        const searches = device.seen.filter(r => r.path.startsWith("/ISAPI/AccessControl/AcsEvent") && r.status === 200).map(r => JSON.parse(r.body).AcsEventCond)
        expect(searches.map(s => s.searchResultPosition)).toEqual([0, 30, 60])
        expect(new Set(searches.map(s => s.searchID)).size).toBe(1)
        // From a day before the first day, its scans kept by the terminal's wall clock.
        expect(searches[0]).toMatchObject({ major: 5, minor: 0, maxResults: 30, startTime: "2026-11-15T00:00:00+02:00" })

        device.state.events.push(...events(3, 66))
        const next = await c.passedChecks(first.cursor, "2026-11-16")
        expect(next.records.map(r => r.userNumber)).toEqual(["166", "167", "168"])
        expect(next.cursor?.serialNo).toBe(68)
        // Asked from a day before the last event's time, so a clock set back by hours still shows.
        const last = device.seen.filter(r => r.path.startsWith("/ISAPI/AccessControl/AcsEvent") && r.status === 200).at(-1)!
        expect(JSON.parse(last.body).AcsEventCond.startTime).toBe("2026-11-15T10:05:00+02:00")
    })

    it("reads the first day from its start by the terminal's wall clock, though its clock doesn't say its offset", async () => {
        device = new FakeHikDevice({
            localTime: "2026-11-16T13:00:00",
            events: [
                { major: 5, minor: 0x4b, time: "2026-11-15T23:30:00+02:00", serialNo: 1, employeeNoString: "101" },
                { major: 5, minor: 0x4b, time: "2026-11-16T00:30:00+02:00", serialNo: 2, employeeNoString: "102" },
            ],
        })
        const { records, cursor } = await client(await device.start()).passedChecks(null, "2026-11-16")
        expect(records).toEqual([{ userNumber: "102", at: "2026-11-16T00:30:00" }])
        expect(cursor?.serialNo).toBe(2)
    })

    it("reads a long history over several reads, each going on from where the last stopped", async () => {
        // A terminal answering one event a page, holding 1,001 scans an hour apart: more than one read takes.
        const hourly = Array.from({ length: 1001 }, (_, i): FakeHikEvent => {
            const wall = new Date(Date.parse("2026-10-01T08:00:00Z") + i * 3_600_000).toISOString().slice(0, 19)
            return { major: 5, minor: 0x4b, time: `${wall}+02:00`, serialNo: i + 1, employeeNoString: String(1000 + i + 1) }
        })
        device = new FakeHikDevice({ events: hourly, pageLimit: 1 })
        const c = client(await device.start())
        const first = await c.passedChecks(null, "2026-10-01")
        expect(first.records).toHaveLength(1000)
        expect(first.cursor?.serialNo).toBe(1000)
        const next = await c.passedChecks(first.cursor, "2026-10-01")
        expect(next.records.map(r => r.userNumber)).toEqual(["2001"])
        expect(next.cursor?.serialNo).toBe(1001)
    }, 30_000)

    it("is an error, not a read that never moves, where a day holds more than one read takes", async () => {
        // 1,002 events a minute apart, one a page: a read looking back a day over them can't get past where it was.
        device = new FakeHikDevice({ events: events(1002), localTime: "2026-11-17T06:00:00+02:00", pageLimit: 1 })
        const c = client(await device.start())
        const first = await c.passedChecks(null, "2026-11-16")
        expect(first.cursor?.serialNo).toBe(1000)
        await expect(c.passedChecks(first.cursor, "2026-11-16")).rejects.toMatchObject({ code: "HIK_TOO_MANY" })
    }, 30_000)

    it("asks for a new challenge once where the terminal calls one stale", async () => {
        device = new FakeHikDevice({ nonceUses: 2 })
        const c = client(await device.start())
        for (let i = 0; i < 3; i++) await c.info()
        expect(device.seen.map(r => r.status)).toEqual([401, 200, 200, 401, 200])
    })

    it("says the user or password is wrong after one more try, and reads nothing", async () => {
        device = new FakeHikDevice()
        const c = client(await device.start(), { password: "wrong" })
        await expect(c.info()).rejects.toMatchObject({ code: "HIK_AUTH_FAILED" })
        expect(device.seen.map(r => r.status)).toEqual([401, 401])
    })

    it("is an error saying what, where the terminal answers otherwise than asked", async () => {
        device = new FakeHikDevice({ failing: { path: "/ISAPI/AccessControl/AcsEvent", status: 500 } })
        const c = client(await device.start())
        await expect(c.passedChecks(null, "2026-11-16")).rejects.toMatchObject({ code: "HIK_HTTP_500" })
        device.state.failing = { path: "/ISAPI/AccessControl/AcsEvent", status: 200, body: "<html>not json</html>" }
        await expect(c.passedChecks(null, "2026-11-16")).rejects.toMatchObject({ code: "HIK_BAD_REPLY" })
        device.state.failing = { path: "/ISAPI/System/deviceInfo", status: 200, body: "<DeviceInfo></DeviceInfo>" }
        await expect(c.info()).rejects.toMatchObject({ code: "HIK_BAD_REPLY" })
        device.state.failing = null
        await expect(client(1).info()).rejects.toMatchObject({ code: "HIK_UNREACHABLE" })
        await expect(client(1).info()).rejects.toBeInstanceOf(HikError)
    })

    it("gives up in its time on a terminal that takes the connection and says nothing, over HTTP or HTTPS", async () => {
        // Over HTTPS such a terminal never finishes the handshake, so the request never gets its socket.
        const sockets: Socket[] = []
        const silent = createNetServer(socket => {
            sockets.push(socket)
            socket.resume()
        })
        await new Promise<void>(resolve => silent.listen(0, "127.0.0.1", resolve))
        const port = (silent.address() as AddressInfo).port
        try {
            for (const https of [false, true]) {
                const started = Date.now()
                await expect(client(port, { https, timeoutMs: 300 }).info()).rejects.toMatchObject({ code: "HIK_TIMEOUT" })
                expect(Date.now() - started).toBeLessThan(2_000)
            }
            expect(sockets.length).toBe(2)
            // Given up, the connection is closed, not left open.
            for (let i = 0; i < 40 && !sockets.every(s => s.readableEnded); i++) await new Promise(resolve => setTimeout(resolve, 25))
            expect(sockets.map(s => s.readableEnded)).toEqual([true, true])
        } finally {
            for (const s of sockets) s.destroy()
            await new Promise<void>(resolve => silent.close(() => resolve()))
        }
    })

    describe("over HTTPS", () => {
        let tls: { cert: string; key: string }
        let dir: string
        beforeAll(() => {
            // A terminal's own certificate, signed by nobody, made for the test and never kept.
            dir = mkdtempSync(join(tmpdir(), "hik-tls-"))
            execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2", "-subj", "/CN=DS-K1T341AM",
                "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], { stdio: "ignore" })
            tls = { cert: readFileSync(join(dir, "cert.pem"), "utf8"), key: readFileSync(join(dir, "key.pem"), "utf8") }
        })
        afterAll(() => rmSync(dir, { recursive: true, force: true }))

        it("says which certificate it saw on the first contact, for the agent to pin", async () => {
            device = new FakeHikDevice()
            const c = client(await device.start(tls), { https: true, pin: null })
            expect((await c.info()).serialNumber).toBe("DS-K1T341AM0020201234")
            expect(c.seenFingerprint).toBe(new X509Certificate(tls.cert).fingerprint256)
        })

        it("reads a terminal showing the pinned certificate, and refuses one showing another before sending it anything", async () => {
            device = new FakeHikDevice()
            const port = await device.start(tls)
            expect((await client(port, { https: true, pin: new X509Certificate(tls.cert).fingerprint256 }).info()).model).toBe("DS-K1T341AM")
            const before = device.seen.length
            await expect(client(port, { https: true, pin: "AA:".repeat(31) + "AA" }).info()).rejects.toMatchObject({ code: "HIK_CERTIFICATE_CHANGED" })
            expect(device.seen.length).toBe(before)
        })

        // Codex on PR 302: each request is a connection of its own, so the first one's certificate holds for the rest.
        it("holds to the first certificate it saw for every later request, when it was given none to pin", async () => {
            const other = selfSigned("DS-K1T341AM-other")
            device = new FakeHikDevice({ renewAfter: { path: "/ISAPI/System/deviceInfo", cert: other.cert, key: other.key } })
            const c = client(await device.start(tls), { https: true, pin: null })
            expect((await c.info()).serialNumber).toBe("DS-K1T341AM0020201234")
            const before = device.seen.length
            await expect(c.clock()).rejects.toMatchObject({ code: "HIK_CERTIFICATE_CHANGED" })
            expect(device.seen.length).toBe(before)
            expect(c.seenFingerprint).toBe(new X509Certificate(tls.cert).fingerprint256)
        })
    })
})
