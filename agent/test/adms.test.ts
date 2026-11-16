import { describe, it, expect, afterEach } from "vitest"
import { request } from "node:http"
import { connect, type Socket } from "node:net"
import * as agent from "../src/zk/adms"
import * as nizmo from "../../lib/attendance/zkteco-adms"
import { callerAddress, listen, type PushListener, type PushSink } from "../src/zk/listener"
import type { Logger } from "../src/sync"

/**
 * The agent's side of ADMS (ATTENDANCE_PLAN.md §17.12, Phase 4 part 8,
 * PR 304): a ZKTeco terminal that pushes only plain HTTP sends to the
 * agent on the office network, and is answered as Nizmo answers one that
 * sends to it. What the agent reads of it is Nizmo's own reading, copied,
 * and held in step here. Nothing in the agent starts the listener yet.
 */

const url = (path: string) => new URL(`http://agent.invalid${path}`)

describe("what the agent reads of a terminal's requests, held in step with Nizmo's", () => {
    const requests: [string, string][] = [
        ["GET", "/iclock/cdata?SN=CB123&options=all&pushver=2.4.1"],
        ["POST", "/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=120"],
        ["POST", "/iclock/cdata.aspx?SN=CB123&Stamp=121"],
        ["POST", "/iclock/cdata?SN=CB123&table=OPERLOG&OpStamp=9"],
        ["POST", "/iclock/cdata?SN=CB123&OpStamp=10"],
        ["GET", "/iclock/getrequest?SN=CB123&INFO=Ver 6.60,12,3,4501,192.168.1.40"],
        ["GET", "/iclock/getrequest?SN=CB123"],
        ["POST", "/iclock/devicecmd?SN=CB123"],
        ["POST", "/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=abc"],
        ["GET", "/iclock/cdata?SN=bad%20serial&options=all"],
        ["GET", "/iclock/cdata?options=all"],
    ]
    it.each(requests)("%s %s", (method, path) => {
        expect(agent.admsRequest(method, url(path))).toEqual(nizmo.admsRequest(method, url(path)))
    })

    it("reads an attendance upload's lines as Nizmo does, without what Nizmo keeps of each line", () => {
        const bodies = [
            "7\t2026-11-16 09:05:00\t0\t1\t0\n12\t2026-11-16 09:06:10\t1\t15\n",
            "7 2026-11-16 09:05:00 0 1\r\n\r\n",
            "garbage\n\t\t\n7\t16/11/2026 09:05\n",
            `${"9".repeat(33)}\t2026-11-16 09:05:00\t0\t1\n`,
            "",
        ]
        for (const body of bodies) {
            const theirs = nizmo.attlogOf(body).map(line => line.kind === "scan" ? { kind: "scan", userNumber: line.userNumber, at: line.at } : line)
            expect(agent.attlogOf(body)).toEqual(theirs)
        }
    })

    it("keeps and moves stamps, answers options and reads INFO as Nizmo does", () => {
        for (const kept of [null, "", "ATTLOG=120;OPERLOG=9", "OPERLOG=3", "ATTLOG=x;OPERLOG=9"]) {
            expect(agent.cursorOf(kept)).toEqual(nizmo.cursorOf(kept))
            expect(agent.cursorWith(kept, { scans: "130" })).toBe(nizmo.cursorWith(kept, { scans: "130" }))
            expect(agent.cursorWith(kept, { people: "11" })).toBe(nizmo.cursorWith(kept, { people: "11" }))
        }
        for (const offset of [120, 0, -300, 330]) {
            expect(agent.optionsAnswer("CB123", { scans: "120", people: "9" }, offset)).toBe(nizmo.optionsAnswer("CB123", { scans: "120", people: "9" }, offset))
        }
        for (const info of [null, "", "Ver 6.60,12,3,4501,192.168.1.40", ",x,,99999999999", "Ver 6.60"]) {
            expect(agent.infoOf(info)).toEqual(nizmo.infoOf(info))
        }
    })
})

describe("what the agent takes of a request, and answers", () => {
    const asked = (method: string, path: string) => agent.admsRequest(method, url(path))!

    it("answers the first call with its options, from where it had got to", () => {
        const taken = agent.take(asked("GET", "/iclock/cdata?SN=CB123&options=all"), null, "ATTLOG=120;OPERLOG=9", 120)
        expect(taken.answer).toBe(nizmo.optionsAnswer("CB123", { scans: "120", people: "9" }, 120))
        expect(taken.scans).toEqual([])
        expect(taken.cursor).toBeNull()
    })

    it("answers one never heard from with stamps of 0, so it sends its whole memory", () => {
        expect(agent.take(asked("GET", "/iclock/cdata?SN=CB123&options=all"), null, null, 0).answer).toContain("\nStamp=0\n")
    })

    it("takes an upload's scans, counts the lines it can't read, and moves the attendance stamp alone", () => {
        const body = "7\t2026-11-16 09:05:00\t0\t1\nnonsense\n12\t2026-11-16 09:06:10\t1\t15\n"
        const taken = agent.take(asked("POST", "/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=130"), body, "ATTLOG=120;OPERLOG=9", 120)
        expect(taken.scans).toEqual([{ userNumber: "7", at: "2026-11-16T09:05:00" }, { userNumber: "12", at: "2026-11-16T09:06:10" }])
        expect(taken.unreadable).toBe(1)
        // As Nizmo answers it: every line counted, read or not.
        expect(taken.answer).toBe("OK: 3\n")
        expect(taken.cursor).toBe("ATTLOG=130;OPERLOG=9")
    })

    it("leaves the stamps as they were when an upload names none", () => {
        const taken = agent.take(asked("POST", "/iclock/cdata?SN=CB123&table=ATTLOG"), "7\t2026-11-16 09:05:00\n", "ATTLOG=120;OPERLOG=9", 0)
        expect(taken.scans).toHaveLength(1)
        expect(taken.cursor).toBeNull()
    })

    it("never opens changes to the people it holds, and moves their stamp", () => {
        const taken = agent.take(asked("POST", "/iclock/cdata?SN=CB123&table=OPERLOG&OpStamp=11"), null, "ATTLOG=120;OPERLOG=9", 0)
        expect(taken).toEqual({ answer: "OK\n", scans: [], unreadable: 0, cursor: "ATTLOG=120;OPERLOG=11", info: null })
    })

    it("answers a poll with no command, and keeps what it says of itself", () => {
        const taken = agent.take(asked("GET", "/iclock/getrequest?SN=CB123&INFO=Ver 6.60,12,3,4501"), null, null, 0)
        expect(taken).toEqual({ answer: "OK\n", scans: [], unreadable: 0, cursor: null, info: { firmware: "Ver 6.60", userCount: 12, recordCount: 4501 } })
    })

    it("answers anything else and drops it unread", () => {
        expect(agent.take(asked("POST", "/iclock/devicecmd?SN=CB123"), null, null, 0)).toEqual({ answer: "OK\n", scans: [], unreadable: 0, cursor: null, info: null })
    })
})

describe("the address a request comes from", () => {
    it("is the IPv4 address inside an IPv4-mapped IPv6 one", () => {
        expect(callerAddress("::ffff:192.168.1.40")).toBe("192.168.1.40")
        expect(callerAddress("192.168.1.40")).toBe("192.168.1.40")
        expect(callerAddress("FE80::1")).toBe("fe80::1")
        expect(callerAddress(undefined)).toBeNull()
        expect(callerAddress("::ffff:not-an-address")).toBe("::ffff:not-an-address")
    })
})

/** What the listener was told, in memory: the agent's state in PR 305. */
class MemorySink implements PushSink {
    cursors = new Map<string, string | null>()
    held = new Set<string>()
    kept: { host: string; serial: string; taken: agent.Taken }[] = []
    failKeep = false
    terminal(host: string, serial: string) {
        return { cursor: this.cursors.get(`${host}|${serial}`) ?? null, held: this.held.has(serial) }
    }
    offsetMinutes() {
        return 120
    }
    keep(host: string, serial: string, taken: agent.Taken) {
        if (this.failKeep) throw new Error("disk full")
        this.kept.push({ host, serial, taken })
        if (taken.cursor) this.cursors.set(`${host}|${serial}`, taken.cursor)
    }
}

class MemoryLog implements Logger {
    lines: string[] = []
    info(m: string) { this.lines.push(`INFO ${m}`) }
    warn(m: string) { this.lines.push(`WARN ${m}`) }
    error(m: string) { this.lines.push(`ERROR ${m}`) }
}

describe("the listener on the office network, against a simulated terminal", () => {
    let listener: PushListener | null = null
    const sockets: Socket[] = []
    afterEach(async () => {
        for (const s of sockets.splice(0)) s.destroy()
        await listener?.close()
        listener = null
    })

    const start = async (hosts: string[], sink = new MemorySink(), log = new MemoryLog(), limits = {}) => {
        listener = await listen({ port: 0, address: "127.0.0.1", hosts, sink, log, limits })
        return { sink, log, base: `http://127.0.0.1:${listener.port}` }
    }

    /** A request as a terminal sends one: plain HTTP, its body as text. */
    const send = (base: string, method: string, path: string, body?: string, headers: Record<string, string> = {}) =>
        new Promise<{ status: number; text: string; connection: string | undefined }>((resolve, reject) => {
            const req = request(`${base}${path}`, { method, headers: { ...headers, ...(body !== undefined && !headers["transfer-encoding"] ? { "content-length": String(Buffer.byteLength(body)) } : {}) } }, res => {
                let text = ""
                res.setEncoding("utf8")
                res.on("data", chunk => { text += chunk })
                res.on("end", () => resolve({ status: res.statusCode ?? 0, text, connection: res.headers.connection }))
            })
            req.on("error", reject)
            if (body !== undefined) req.write(body)
            req.end()
        })

    it("answers a named terminal's first call with its options", async () => {
        const { base, sink } = await start(["127.0.0.1"])
        sink.cursors.set("127.0.0.1|CB123", "ATTLOG=120;OPERLOG=9")
        const res = await send(base, "GET", "/iclock/cdata?SN=CB123&options=all&pushver=2.4.1")
        expect(res.status).toBe(200)
        expect(res.text).toBe(nizmo.optionsAnswer("CB123", { scans: "120", people: "9" }, 120))
    })

    it("takes its scans, keeps them with the stamp in one call, and answers OK", async () => {
        const { base, sink } = await start(["127.0.0.1"])
        const res = await send(base, "POST", "/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=5", "7\t2026-11-16 09:05:00\t0\t1\n12\t2026-11-16 09:06:10\t1\t15\n")
        expect(res).toMatchObject({ status: 200, text: "OK: 2\n" })
        expect(sink.kept).toHaveLength(1)
        expect(sink.kept[0]).toMatchObject({ host: "127.0.0.1", serial: "CB123", taken: { cursor: "ATTLOG=5;OPERLOG=0", scans: [{ userNumber: "7", at: "2026-11-16T09:05:00" }, { userNumber: "12", at: "2026-11-16T09:06:10" }] } })
        // The next upload moves on from there.
        await send(base, "POST", "/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=6", "7\t2026-11-16 17:00:00\n")
        expect(sink.kept[1].taken.cursor).toBe("ATTLOG=6;OPERLOG=0")
    })

    it("logs the lines of an upload it can't read", async () => {
        const { base, log } = await start(["127.0.0.1"])
        await send(base, "POST", "/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=5", "nonsense\n7\t2026-11-16 09:05:00\n")
        expect(log.lines.filter(l => l.startsWith("WARN"))).toEqual([expect.stringContaining("1 line(s)")])
    })

    it("never reads an upload of changes to people: names are in it", async () => {
        const { base, sink } = await start(["127.0.0.1"])
        const res = await send(base, "POST", "/iclock/cdata?SN=CB123&table=OPERLOG&OpStamp=4", "USER PIN=7\tName=Somebody\n7\t2026-11-16 09:05:00\n")
        expect(res).toMatchObject({ status: 200, text: "OK\n" })
        expect(sink.kept[0].taken).toEqual({ answer: "OK\n", scans: [], unreadable: 0, cursor: "ATTLOG=0;OPERLOG=4", info: null })
    })

    it("refuses an address no terminal in agent.json is at, with nothing in it, and logs it once an hour", async () => {
        const { base, sink, log } = await start(["192.168.1.40"])
        const first = await send(base, "GET", "/iclock/cdata?SN=CB123&options=all")
        const second = await send(base, "POST", "/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=5", "7\t2026-11-16 09:05:00\n")
        expect(first).toMatchObject({ status: 403, text: "", connection: "close" })
        expect(second.status).toBe(403)
        expect(sink.kept).toEqual([])
        expect(log.lines).toEqual([expect.stringMatching(/^WARN 127\.0\.0\.1 called the agent/)])
    })

    it("answers 404 to anything but GET or POST under /iclock/ naming a serial number", async () => {
        const { base, sink } = await start(["127.0.0.1"])
        for (const [method, path] of [["GET", "/"], ["GET", "/api/agent/heartbeat?SN=CB123"], ["PUT", "/iclock/cdata?SN=CB123&options=all"], ["GET", "/iclock/cdata?options=all"], ["GET", "/iclock/cdata?SN=has%20space&options=all"]]) {
            const res = await send(base, method, path)
            expect(res.status, `${method} ${path}`).toBe(404)
            expect(res.text).toBe("")
        }
        expect(sink.kept).toEqual([])
    })

    it("holds a terminal Nizmo says is set straight to it: 503, so it keeps its scans", async () => {
        const { base, sink } = await start(["127.0.0.1"])
        sink.held.add("CB123")
        const res = await send(base, "POST", "/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=5", "7\t2026-11-16 09:05:00\n")
        expect(res.status).toBe(503)
        expect(sink.kept).toEqual([])
    })

    it("answers 500 and keeps nothing when what it took can't be kept, so the terminal sends it again", async () => {
        const { base, sink, log } = await start(["127.0.0.1"])
        sink.failKeep = true
        const res = await send(base, "POST", "/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=5", "7\t2026-11-16 09:05:00\n")
        expect(res.status).toBe(500)
        expect(log.lines).toEqual([expect.stringMatching(/^ERROR .*CB123.*disk full/)])
    })

    it("refuses a body past its limit, whether it says its length or not", async () => {
        const { base, sink, log } = await start(["127.0.0.1"], new MemorySink(), new MemoryLog(), { bodyBytes: 1024 })
        const big = `${"7\t2026-11-16 09:05:00\n".repeat(60)}`
        const said = await send(base, "POST", "/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=5", big)
        expect(said).toMatchObject({ status: 413, connection: "close" })
        const unsaid = await send(base, "POST", "/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=5", big, { "transfer-encoding": "chunked" })
        expect(unsaid.status).toBe(413)
        expect(sink.kept).toEqual([])
        expect(log.lines.filter(l => l.includes("too large"))).toHaveLength(2)
        // Within it, the same upload is taken.
        expect((await send(base, "POST", "/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=5", "7\t2026-11-16 09:05:00\n")).status).toBe(200)
    })

    it("closes a request whose headers don't come in time", async () => {
        const { base } = await start(["127.0.0.1"], new MemorySink(), new MemoryLog(), { headersMs: 300, requestMs: 600 })
        const port = Number(new URL(base).port)
        const socket = connect(port, "127.0.0.1")
        sockets.push(socket)
        let heard = ""
        socket.setEncoding("utf8")
        socket.on("data", d => { heard += d })
        socket.write("GET /iclock/getrequest?SN=CB123 HTTP/1.1\r\nHost: agent\r\n")
        await new Promise<void>(resolve => socket.on("close", () => resolve()))
        expect(heard).toMatch(/^HTTP\/1\.1 408/)
    })

    it("takes no more connections at once than its limit", async () => {
        const { base } = await start(["127.0.0.1"], new MemorySink(), new MemoryLog(), { connections: 1 })
        const port = Number(new URL(base).port)
        const first = connect(port, "127.0.0.1")
        sockets.push(first)
        await new Promise<void>(resolve => first.on("connect", () => resolve()))
        const second = connect(port, "127.0.0.1")
        sockets.push(second)
        await new Promise<void>(resolve => second.on("close", () => resolve()))
        expect(first.destroyed).toBe(false)
    })

    it("says so when its port is taken", async () => {
        const { base } = await start(["127.0.0.1"])
        const port = Number(new URL(base).port)
        await expect(listen({ port, address: "127.0.0.1", hosts: ["127.0.0.1"], sink: new MemorySink(), log: new MemoryLog() })).rejects.toThrow(`Port ${port} is in use`)
    })

    it("stops listening when closed", async () => {
        const { base } = await start(["127.0.0.1"])
        await listener!.close()
        listener = null
        await expect(send(base, "GET", "/iclock/cdata?SN=CB123&options=all")).rejects.toThrow()
    })
})
