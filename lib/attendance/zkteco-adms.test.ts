import { describe, it, expect } from "vitest"
import { admsRequest, attlogOf, cursorOf, cursorWith, infoOf, optionsAnswer, ICLOCK_ROUTE } from "./zkteco-adms"

/**
 * What a ZKTeco terminal straight to Nizmo asks and sends, read
 * (ATTENDANCE_PLAN.md §17.3, Phase 4 part 6, PR 296). The shapes are from
 * ZKTeco's own HTTP PUSH SDK 2.0.1 document (§17.11), with later
 * firmware's names beside them. No terminal is on hand: the trial has the
 * last word (§17.8).
 */

const ask = (method: string, path: string) => admsRequest(method, new URL(`https://nizmo.example${path}`))

describe("what a terminal is asking for", () => {
    it("is its options, on a GET to cdata that asks for them", () => {
        expect(ask("GET", "/iclock/cdata?SN=ABC123&options=all")).toEqual({ kind: "options", serial: "ABC123" })
        expect(ask("GET", "/iclock/cdata?SN=ABC123&options=all&pushver=2.4.1&language=69")).toEqual({ kind: "options", serial: "ABC123" })
        // Another GET to cdata, such as one asking the time, isn't answered with options.
        expect(ask("GET", "/iclock/cdata?SN=ABC123&type=time")).toEqual({ kind: "other", serial: "ABC123" })
    })

    it("is scans, on a POST to cdata for the attendance log, named or as old firmware sends it", () => {
        expect(ask("POST", "/iclock/cdata?SN=ABC123&table=ATTLOG&Stamp=9999")).toEqual({ kind: "scans", serial: "ABC123", stamp: "9999" })
        expect(ask("POST", "/iclock/cdata?SN=ABC123&table=attlog&Stamp=12")).toEqual({ kind: "scans", serial: "ABC123", stamp: "12" })
        // The 2.0.1 document's own upload: a Stamp and no table.
        expect(ask("POST", "/iclock/cdata?SN=ABC123&Stamp=99999999")).toEqual({ kind: "scans", serial: "ABC123", stamp: "99999999" })
        // A stamp that isn't a number isn't kept.
        expect(ask("POST", "/iclock/cdata?SN=ABC123&table=ATTLOG&Stamp=None")).toEqual({ kind: "scans", serial: "ABC123", stamp: null })
        expect(ask("POST", "/iclock/cdata?SN=ABC123&table=ATTLOG&Stamp=1;DROP")).toEqual({ kind: "scans", serial: "ABC123", stamp: null })
        expect(ask("POST", `/iclock/cdata?SN=ABC123&table=ATTLOG&Stamp=${"9".repeat(21)}`)).toEqual({ kind: "scans", serial: "ABC123", stamp: null })
    })

    it("is the log of changes to people, which is never opened", () => {
        expect(ask("POST", "/iclock/cdata?SN=ABC123&table=OPERLOG&OpStamp=77")).toEqual({ kind: "people", serial: "ABC123", stamp: "77" })
        expect(ask("POST", "/iclock/cdata?SN=ABC123&OpStamp=78")).toEqual({ kind: "people", serial: "ABC123", stamp: "78" })
        // Later firmware names the stamp Stamp for this table too.
        expect(ask("POST", "/iclock/cdata?SN=ABC123&table=OPERLOG&Stamp=79")).toEqual({ kind: "people", serial: "ABC123", stamp: "79" })
    })

    it("is its heartbeat, on a GET to getrequest, with what it says of itself", () => {
        expect(ask("GET", "/iclock/getrequest?SN=ABC123")).toEqual({ kind: "poll", serial: "ABC123", info: null })
        expect(ask("GET", "/iclock/getrequest?SN=ABC123&INFO=Ver%206.39%20Apr%2028%202008,2,0,57,192.168.1.201")).toEqual({
            kind: "poll", serial: "ABC123", info: { firmware: "Ver 6.39 Apr 28 2008", userCount: 2, recordCount: 57 },
        })
    })

    it("is something else for any other table, path or method under /iclock", () => {
        for (const [method, path] of [
            ["POST", "/iclock/cdata?SN=ABC123&table=ATTPHOTO&Stamp=5"],
            ["POST", "/iclock/cdata?SN=ABC123&table=USERINFO"],
            ["POST", "/iclock/cdata?SN=ABC123"],
            ["POST", "/iclock/devicecmd?SN=ABC123"],
            ["POST", "/iclock/registry?SN=ABC123"],
            ["GET", "/iclock/ping?SN=ABC123"],
            ["POST", "/iclock/getrequest?SN=ABC123"],
            ["GET", "/iclock/fdata?SN=ABC123&table=ATTLOG"],
            ["GET", "/iclock/a/b/cdata?SN=ABC123&options=all"],
        ] as const) expect(ask(method, path), `${method} ${path}`).toEqual({ kind: "other", serial: "ABC123" })
    })

    it("takes a path as old servers had it, with its ending", () => {
        expect(ask("GET", "/iclock/cdata.aspx?SN=ABC123&options=all")).toEqual({ kind: "options", serial: "ABC123" })
        expect(ask("GET", "/iclock/getrequest.aspx?SN=ABC123")).toEqual({ kind: "poll", serial: "ABC123", info: null })
    })

    it("is nobody's without a serial number that could be one", () => {
        for (const path of [
            "/iclock/cdata?options=all",
            "/iclock/cdata?SN=&options=all",
            `/iclock/cdata?SN=${"A".repeat(65)}&options=all`,
            "/iclock/cdata?SN=AB%20C&options=all",
            "/iclock/cdata?SN=AB%0AC&options=all",
            "/iclock/cdata?SN=%D8%A3&options=all",
        ]) expect(ask("GET", path), path).toBeNull()
        // The longest a terminal's record holds, and the marks a serial number may carry.
        expect(ask("GET", `/iclock/cdata?SN=${"A".repeat(64)}&options=all`)).toEqual({ kind: "options", serial: "A".repeat(64) })
        expect(ask("GET", "/iclock/cdata?SN=CB-3000_x.1&options=all")).toEqual({ kind: "options", serial: "CB-3000_x.1" })
        // Only its own name for it is read.
        expect(ask("GET", "/iclock/cdata?sn=ABC123&options=all")).toBeNull()
    })

    it("names its route by its pattern", () => {
        expect(ICLOCK_ROUTE).toBe("/iclock/[...path]")
    })
})

describe("where a terminal had got to", () => {
    it("starts at 0 in both logs, so one never heard from sends its whole memory", () => {
        expect(cursorOf(null)).toEqual({ scans: "0", people: "0" })
        expect(cursorOf("")).toEqual({ scans: "0", people: "0" })
        expect(cursorOf("nonsense")).toEqual({ scans: "0", people: "0" })
    })

    it("is kept for each log, and one's change leaves the other", () => {
        const first = cursorWith(null, { scans: "120" })
        expect(first).toBe("ATTLOG=120;OPERLOG=0")
        expect(cursorOf(first)).toEqual({ scans: "120", people: "0" })
        const second = cursorWith(first, { people: "9" })
        expect(second).toBe("ATTLOG=120;OPERLOG=9")
        expect(cursorOf(cursorWith(second, { scans: "121" }))).toEqual({ scans: "121", people: "9" })
        // Only numbers are read back.
        expect(cursorOf("ATTLOG=12x;OPERLOG=-4")).toEqual({ scans: "0", people: "0" })
    })
})

describe("the options a first call is answered with", () => {
    it("are ZKTeco's own, a line each, with later firmware's names for the stamps", () => {
        expect(optionsAnswer("ABC123", { scans: "120", people: "9" }, 120).split("\n")).toEqual([
            "GET OPTION FROM: ABC123",
            "Stamp=120",
            "ATTLOGStamp=120",
            "OpStamp=9",
            "OPERLOGStamp=9",
            "ErrorDelay=60",
            "Delay=30",
            "TransTimes=00:00;14:05",
            "TransInterval=1",
            "TransFlag=1000000000",
            "Realtime=1",
            "Encrypt=0",
            "TimeZone=2",
            "",
        ])
    })

    it("ask for attendance records and nothing else", () => {
        const options = optionsAnswer("ABC123", cursorOf(null), 180)
        expect(options).toContain("\nTransFlag=1000000000\n")
        expect(options).not.toContain("1111")
        expect(options).not.toContain("TransData")
        // And send no command: only options.
        expect(options).not.toMatch(/^C:/m)
    })

    it("state the company's offset from UTC in whole hours, and none for a zone off the hour", () => {
        expect(optionsAnswer("S", cursorOf(null), 180)).toContain("\nTimeZone=3\n")
        expect(optionsAnswer("S", cursorOf(null), 0)).toContain("\nTimeZone=0\n")
        expect(optionsAnswer("S", cursorOf(null), -300)).toContain("\nTimeZone=-5\n")
        expect(optionsAnswer("S", cursorOf(null), 330)).not.toContain("TimeZone")
        expect(optionsAnswer("S", cursorOf(null), -210)).not.toContain("TimeZone")
    })
})

describe("the lines of an attendance upload", () => {
    it("are a scan each: the employee number, the terminal's wall clock, and what it keeps", () => {
        expect(attlogOf("982\t2008-02-25 12:08:21\t1\t0\r\n982\t2008-02-25 18:01:09\t1\t0\r\n")).toEqual([
            { kind: "scan", userNumber: "982", at: "2008-02-25T12:08:21", kept: { time: "2008-02-25 12:08:21", status: "1", verify: "0" } },
            { kind: "scan", userNumber: "982", at: "2008-02-25T18:01:09", kept: { time: "2008-02-25 18:01:09", status: "1", verify: "0" } },
        ])
    })

    it("keep a work code from later firmware, and nothing past it", () => {
        expect(attlogOf("7\t2026-09-14 09:05:00\t0\t15\t3\t0\t0\t255\t36.5\n")).toEqual([
            { kind: "scan", userNumber: "7", at: "2026-09-14T09:05:00", kept: { time: "2026-09-14 09:05:00", status: "0", verify: "15", workCode: "3" } },
        ])
        // Only short numbers are kept: nothing a field nobody foresaw could carry.
        expect(attlogOf("7\t2026-09-14 09:05:00\tSomebody\t1\tx".concat("\n"))).toEqual([
            { kind: "scan", userNumber: "7", at: "2026-09-14T09:05:00", kept: { time: "2026-09-14 09:05:00", verify: "1" } },
        ])
    })

    it("are read with spaces where the tabs were, and with either line ending", () => {
        expect(attlogOf("982 2008-02-25 12:08:21 1 0\n983  2008-02-25 12:09:00 0 1")).toEqual([
            { kind: "scan", userNumber: "982", at: "2008-02-25T12:08:21", kept: { time: "2008-02-25 12:08:21", status: "1", verify: "0" } },
            { kind: "scan", userNumber: "983", at: "2008-02-25T12:09:00", kept: { time: "2008-02-25 12:09:00", status: "0", verify: "1" } },
        ])
        expect(attlogOf("\r\n\n   \n")).toEqual([])
        expect(attlogOf("")).toEqual([])
    })

    it("leave a time no calendar has to the steps every scan goes through", () => {
        // The shape is a time's: whether it is a real one is checked with every terminal's scans (§17.6).
        expect(attlogOf("7\t2026-02-30 25:61:00\t0\t1")).toEqual([
            { kind: "scan", userNumber: "7", at: "2026-02-30T25:61:00", kept: { time: "2026-02-30 25:61:00", status: "0", verify: "1" } },
        ])
    })

    it("are counted as refused when they can't be read, or name a number too long to be anyone's", () => {
        expect(attlogOf("7\tyesterday\t0\t1")).toEqual([{ kind: "refused", reason: "UNREADABLE" }])
        expect(attlogOf("7")).toEqual([{ kind: "refused", reason: "UNREADABLE" }])
        expect(attlogOf("\t2026-09-14 09:05:00\t0\t1")).toEqual([{ kind: "refused", reason: "UNREADABLE" }])
        // Seconds since 1970, as some firmware is said to send: not read, and so seen in the trial.
        expect(attlogOf("7\t1789376700\t0\t1")).toEqual([{ kind: "refused", reason: "UNREADABLE" }])
        expect(attlogOf(`${"9".repeat(33)}\t2026-09-14 09:05:00\t0\t1`)).toEqual([{ kind: "refused", reason: "INVALID_NUMBER" }])
        expect(attlogOf(`${"9".repeat(32)}\t2026-09-14 09:05:00\t0\t1`)[0]).toMatchObject({ kind: "scan", userNumber: "9".repeat(32) })
    })

    it("are each read on their own: one that can't be doesn't lose the rest", () => {
        expect(attlogOf("7\t2026-09-14 09:05:00\t0\t1\ngarbage\n8\t2026-09-14 09:06:00\t0\t1").map(l => l.kind)).toEqual(["scan", "refused", "scan"])
    })
})

describe("what a terminal says of itself", () => {
    it("is its firmware, how many people it holds and how many records", () => {
        expect(infoOf("Ver 6.39 Apr 28 2008,2,0,57,192.168.1.201")).toEqual({ firmware: "Ver 6.39 Apr 28 2008", userCount: 2, recordCount: 57 })
        // Later firmware says more after these: it isn't read.
        expect(infoOf("Ver 8.0.4.2-20230605,120,300,45000,10.0.0.9,10,7,12,120,11110")).toEqual({ firmware: "Ver 8.0.4.2-20230605", userCount: 120, recordCount: 45000 })
    })

    it("never keeps its address on the office network", () => {
        expect(JSON.stringify(infoOf("Ver 6.39,2,0,57,192.168.1.201"))).not.toContain("192.168")
    })

    it("leaves out what isn't a count, and is nothing when it says nothing", () => {
        expect(infoOf("Ver 6.39,many,0,-3,1.2.3.4")).toEqual({ firmware: "Ver 6.39", userCount: null, recordCount: null })
        expect(infoOf("Ver 6.39")).toEqual({ firmware: "Ver 6.39", userCount: null, recordCount: null })
        expect(infoOf(`${"V".repeat(80)},1,1,1`)).toEqual({ firmware: "V".repeat(50), userCount: 1, recordCount: 1 })
        expect(infoOf(",99999999999,0,5")).toEqual({ firmware: null, userCount: null, recordCount: 5 })
        expect(infoOf("")).toBeNull()
        expect(infoOf(null)).toBeNull()
        expect(infoOf("   ")).toBeNull()
    })
})
