import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync } from "node:fs"
import { createServer, request, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SyncAgent, type Logger } from "../src/sync"
import { parseConfig, type AgentConfig } from "../src/config"
import { emptyState, loadState, type AgentState } from "../src/state"
import { FakeServer } from "./fake-server"

/**
 * A ZKTeco terminal that pushes to the agent (ATTENDANCE_PLAN.md §17.12,
 * Phase 4 part 8, PR 305): named in agent.json with "push": true, listened
 * for by the service, its scans queued with its stamps in one write and
 * delivered with the agent's own, against a stand-in for the website that
 * checks what it's sent against the website's own schemas.
 */

const quiet = (): Logger & { lines: string[] } => {
    const lines: string[] = []
    return { lines, info: m => lines.push(`info ${m}`), warn: m => lines.push(`warn ${m}`), error: m => lines.push(`error ${m}`) }
}

describe("the config file, for a terminal that pushes", () => {
    const config = (devices: object[], extra: object = {}) => parseConfig({ server: "https://x.co", devices, ...extra })

    it("keeps it apart from the terminals the agent reads, by its IP address, and listens on 8081 unless set", () => {
        const c = config([{ host: "192.168.1.20" }, { host: " 192.168.1.40 ", push: true, name: "Side door" }])
        expect(c.devices).toEqual([{ protocol: "zkteco", host: "192.168.1.20", port: 4370, password: 0, name: null }])
        expect(c.pushers).toEqual([{ host: "192.168.1.40", name: "Side door" }])
        expect(c.listenPort).toBe(8081)
        expect(config([{ host: "192.168.1.40", push: true, protocol: "ZKTeco" }], { listenPort: 9000 })).toMatchObject({ pushers: [{ host: "192.168.1.40", name: null }], listenPort: 9000 })
        // As a request's address is read: an IPv6 one in its shortest form, in small letters (Codex on PR 305).
        expect(config([{ host: "FE80::1", push: true }]).pushers[0].host).toBe("fe80::1")
        expect(config([{ host: "0:0:0:0:0:0:0:1", push: true }]).pushers[0].host).toBe("::1")
        expect(config([{ host: "::ffff:192.168.1.40", push: true }]).pushers[0].host).toBe("192.168.1.40")
        // "push": false is a terminal the agent reads, as without it.
        expect(config([{ host: "192.168.1.40", push: false }]).devices).toHaveLength(1)
        expect(config([]).pushers).toEqual([])
    })

    it("refuses what can't work for one, saying what to set", () => {
        const refused = (d: object, extra: object = {}) => () => config([{ host: "192.168.1.20" }, { host: "192.168.1.40", push: true, ...d }], extra)
        expect(refused({ host: "side-door.office" })).toThrow('Terminal 2: "host" must be its IP address on this network, such as 192.168.1.40, for a terminal that pushes.')
        expect(refused({ port: 8081 })).toThrow('Terminal 2 pushes to the agent on "listenPort": it has no "port" of its own.')
        expect(refused({ protocol: "hikvision", user: "u", password: "p" })).toThrow('Terminal 2: "push" is for a ZKTeco terminal.')
        expect(refused({ push: "yes" })).toThrow('Terminal 2: "push" must be true or false.')
        expect(refused({ name: "x".repeat(81) })).toThrow("80 characters")
        expect(refused({ host: "192.168.1.20" })).toThrow("Terminal 2 is at 192.168.1.20, where a terminal the agent reads is: one terminal is read or pushes, not both.")
        expect(() => config([{ host: "192.168.1.40", push: true }, { host: "192.168.1.40", push: true }])).toThrow("The same terminal is listed twice.")
        // The same address, written two ways.
        expect(() => config([{ host: "::1", push: true }, { host: "0:0:0:0:0:0:0:1", push: true }])).toThrow("The same terminal is listed twice.")
        expect(() => config([{ host: "0:0:0:0:0:0:0:1" }, { host: "::1", push: true }])).toThrow("one terminal is read or pushes, not both")
        for (const listenPort of [0, 70000, "x", 80.5]) expect(refused({}, { listenPort })).toThrow('"listenPort" must be a number from 1 to 65535.')
    })

    it("reads the example an office copies, one that pushes among them", () => {
        const example = parseConfig(JSON.parse(readFileSync("agent/agent.example.json", "utf8")))
        expect(example.pushers).toEqual([{ host: "192.168.1.40", name: "Side door" }])
        expect(example.listenPort).toBe(8081)
    })
})

describe("a terminal that pushes to the agent", () => {
    let server: FakeServer, dir: string, config: AgentConfig, state: AgentState, log: ReturnType<typeof quiet>, agent: SyncAgent
    let now: number
    const statePath = () => join(dir, "state.json")
    const saved = () => loadState(statePath())
    const make = () => new SyncAgent(config, state, statePath(), log, undefined, undefined, () => now)
    const MINUTE = 60_000

    /** A request as the terminal sends one: plain HTTP to the agent's PC, its body as text. */
    const send = (method: string, path: string, body?: string) => new Promise<{ status: number; text: string }>((resolve, reject) => {
        const req = request(`http://127.0.0.1:${agent.listeningPort}${path}`, { method, headers: body === undefined ? {} : { "content-length": String(Buffer.byteLength(body)) } }, res => {
            let text = ""
            res.setEncoding("utf8")
            res.on("data", chunk => { text += chunk })
            res.on("end", () => resolve({ status: res.statusCode ?? 0, text }))
        })
        req.on("error", reject)
        if (body !== undefined) req.write(body)
        req.end()
    })
    const options = () => send("GET", "/iclock/cdata?SN=CB123&options=all&pushver=2.4.1")
    const poll = (serial = "CB123") => send("GET", `/iclock/getrequest?SN=${serial}&INFO=Ver 6.60 Nov 2024,12,3,4501,192.168.1.40`)
    const upload = (stamp: number, body: string) => send("POST", `/iclock/cdata?SN=CB123&table=ATTLOG&Stamp=${stamp}`, body)
    const pushedReport = () => server.heartbeats.at(-1).devices.find((d: { serialNumber: string }) => d.serialNumber === "CB123")

    beforeEach(async () => {
        server = new FakeServer()
        await server.start()
        dir = mkdtempSync(join(tmpdir(), "agent-push-"))
        state = emptyState()
        log = quiet()
        now = Date.parse("2026-11-16T10:00:00Z")
        config = parseConfig({ server: server.url, sendFrom: "2026-11-01", devices: [{ host: "127.0.0.1", push: true, name: "Side door" }] })
        agent = make()
    })
    afterEach(async () => {
        await agent.stopListening()
        await server.stop()
    })

    it("is held until the agent is enrolled, then answered with its options in the company's time zone", async () => {
        await agent.listen(0, "127.0.0.1")
        expect(log.lines).toContain(`info Listening on port ${agent.listeningPort} for 1 terminal(s) that push: 127.0.0.1.`)
        expect((await options()).status).toBe(503)
        await agent.enrol("K7QD-2MXP")
        const answered = await options()
        expect(answered.status).toBe(200)
        expect(answered.text).toContain("\nStamp=0\n")
        // Cairo, UTC+2 in November.
        expect(answered.text).toContain("\nTimeZone=2\n")
        expect(saved().pushers["127.0.0.1"]).toMatchObject({ serialNumber: "CB123", pushCursor: null })
    })

    it("queues its scans and moves its stamp in one write, then delivers them with the next round, reported with what it says of itself", async () => {
        await agent.enrol("K7QD-2MXP")
        await agent.listen(0, "127.0.0.1")
        // One before sendFrom, and two after.
        const res = await upload(5, "7\t2026-10-30 09:00:00\t0\t1\n7\t2026-11-16 09:05:00\t0\t1\n12\t2026-11-16 09:06:10\t1\t15\n")
        expect(res).toEqual({ status: 200, text: "OK: 3\n" })
        expect(saved().queue).toEqual([
            { serialNumber: "CB123", userNumber: "7", at: "2026-11-16T09:05:00" },
            { serialNumber: "CB123", userNumber: "12", at: "2026-11-16T09:06:10" },
        ])
        expect(saved().pushers["127.0.0.1"].pushCursor).toBe("ATTLOG=5;OPERLOG=0")
        expect((await poll()).status).toBe(200)

        const round = await agent.round()
        expect(round).toMatchObject({ read: 0, pushed: 2, delivered: 2, refused: 0, unreachable: [], stopped: null })
        expect([...server.stored.values()]).toHaveLength(2)
        expect(pushedReport()).toEqual({ serialNumber: "CB123", name: "Side door", firmware: "Ver 6.60 Nov 2024", userCount: 12, recordCount: 4501, protocol: "ZKTECO", reachable: true })
        // Its next first call starts from where it got to.
        expect((await options()).text).toContain("\nStamp=5\n")
        // Counted once: the next round has nothing new.
        expect(await agent.round()).toMatchObject({ pushed: 0, delivered: 0 })
    })

    it("puts the queue and its stamps back when they can't be saved, so the terminal sends them again", async () => {
        await agent.enrol("K7QD-2MXP")
        await agent.listen(0, "127.0.0.1")
        expect((await upload(5, "7\t2026-11-16 09:05:00\n")).status).toBe(200)
        // The state can't be written: where its next copy goes is taken.
        mkdirSync(`${statePath()}.tmp`)
        expect((await upload(6, "8\t2026-11-16 09:10:00\n")).status).toBe(500)
        expect(state.queue).toHaveLength(1)
        expect(state.pushers["127.0.0.1"].pushCursor).toBe("ATTLOG=5;OPERLOG=0")
        expect(log.lines.some(l => l.startsWith("error ") && l.includes("could not be kept"))).toBe(true)
        // Sent again once it can be.
        rmdirSync(`${statePath()}.tmp`)
        expect((await upload(6, "8\t2026-11-16 09:10:00\n")).status).toBe(200)
        expect(saved().queue.map(p => p.userNumber)).toEqual(["7", "8"])
        expect(saved().pushers["127.0.0.1"].pushCursor).toBe("ATTLOG=6;OPERLOG=0")
    })

    it("is held while Nizmo has it set straight to Nizmo, so it keeps its scans, and taken again once it's set back", async () => {
        await agent.enrol("K7QD-2MXP")
        await agent.listen(0, "127.0.0.1")
        await poll()
        await agent.round()
        server.devices.set("CB123", { state: "DIRECT", mode: "ANY" })
        await agent.round()
        expect(saved().pushers["127.0.0.1"].direct).toBe(true)
        expect(log.lines.some(l => l.includes("CB123 is set to connect straight to Nizmo"))).toBe(true)
        // Still heard from while held, and reported, so the agent hears when it's set back.
        now += 4 * MINUTE
        expect((await upload(5, "7\t2026-11-16 09:05:00\n")).status).toBe(503)
        expect(state.queue).toEqual([])
        await agent.round()
        expect(pushedReport()).toMatchObject({ reachable: true })
        server.devices.set("CB123", { state: "ACTIVE", mode: "ANY" })
        await agent.round()
        expect(saved().pushers["127.0.0.1"].direct).toBe(false)
        expect((await upload(5, "7\t2026-11-16 09:05:00\n")).status).toBe(200)
        expect(state.queue).toHaveLength(1)
    })

    it("takes another terminal at its address as another terminal, its stamps from 0", async () => {
        await agent.enrol("K7QD-2MXP")
        await agent.listen(0, "127.0.0.1")
        await upload(5, "7\t2026-11-16 09:05:00\n")
        const other = await send("GET", "/iclock/cdata?SN=CB999&options=all")
        expect(other.text).toContain("GET OPTION FROM: CB999\nStamp=0\n")
        await poll("CB999")
        expect(saved().pushers["127.0.0.1"]).toMatchObject({ serialNumber: "CB999", pushCursor: null })
        expect(log.lines).toContain("warn 127.0.0.1 is now terminal CB999 (was CB123); it sends its memory from the start.")
    })

    it("is reported reachable while heard from in the last 3 minutes, not at all before it first calls or in the agent's first 3 minutes, and unreachable after", async () => {
        await agent.enrol("K7QD-2MXP")
        await agent.listen(0, "127.0.0.1")
        await agent.round()
        await agent.round()
        expect(server.heartbeats.at(-1).devices).toEqual([])
        // Said once, whatever the rounds.
        expect(log.lines.filter(l => l.includes("hasn't called yet"))).toEqual([
            "info Terminal at 127.0.0.1 pushes to this agent and hasn't called yet. On it, Cloud Server Setting names this PC's address and port 8081, with HTTPS off.",
        ])
        await poll()
        now += 2 * MINUTE
        await agent.round()
        expect(pushedReport()).toMatchObject({ reachable: true })
        now += 2 * MINUTE
        await agent.round()
        expect(pushedReport()).toMatchObject({ reachable: false, error: "Not heard from since 2026-11-16T10:00:00.000Z." })

        // A new run: one known from before isn't reported until it's heard from, or 3 minutes have gone.
        await agent.stopListening()
        agent = make()
        await agent.listen(0, "127.0.0.1")
        const before = server.heartbeats.length
        await agent.round()
        expect(server.heartbeats.at(-1).devices).toEqual([])
        now += 4 * MINUTE
        await agent.round()
        expect(server.heartbeats.length).toBe(before + 2)
        expect(pushedReport()).toMatchObject({ reachable: false, error: "Not heard from since the agent started." })
    })

    it("says why when it can't listen, reports the terminal unreachable with the reason, and tries again each round", async () => {
        await agent.enrol("K7QD-2MXP")
        state.pushers["127.0.0.1"] = { serialNumber: "CB123", pushCursor: null }
        const taken: Server = createServer()
        await new Promise<void>(r => taken.listen(0, "127.0.0.1", r))
        const port = (taken.address() as AddressInfo).port
        await agent.listen(port, "127.0.0.1")
        await agent.listen(port, "127.0.0.1")
        expect(agent.listeningPort).toBeNull()
        expect(log.lines.filter(l => l.startsWith("error "))).toEqual([`error Can't listen for terminals that push: Port ${port} is in use by another program on this PC. Trying again each round.`])
        await agent.round()
        expect(pushedReport()).toEqual({ serialNumber: "CB123", name: "Side door", protocol: "ZKTECO", reachable: false, error: `The agent can't listen for it: Port ${port} is in use by another program on this PC.` })
        await new Promise<void>(r => taken.close(() => r()))
        await agent.listen(port, "127.0.0.1")
        expect(agent.listeningPort).toBe(port)
    })

    it("starts its stamps again from 0 when sendFrom is set earlier, so it sends its memory again when it next asks for its options", async () => {
        await agent.enrol("K7QD-2MXP")
        await agent.listen(0, "127.0.0.1")
        await upload(5, "7\t2026-11-16 09:05:00\n")
        await agent.round()
        await agent.stopListening()
        config = parseConfig({ server: server.url, sendFrom: "2026-10-01", devices: [{ host: "127.0.0.1", push: true }] })
        agent = make()
        await agent.round()
        expect(saved().pushers["127.0.0.1"].pushCursor).toBeNull()
        await agent.listen(0, "127.0.0.1")
        // What it sends before it asks for its options doesn't undo that (Codex on PR 305): its scans are taken, its stamps stay at 0.
        expect((await upload(6, "8\t2026-11-16 09:10:00\n")).status).toBe(200)
        expect(saved().queue.map(p => p.userNumber)).toEqual(["8"])
        expect(saved().pushers["127.0.0.1"]).toMatchObject({ pushCursor: null, resend: true })
        expect((await options()).text).toContain("\nStamp=0\n")
        // Told 0, it sends from there, and its stamps move on as before.
        expect(saved().pushers["127.0.0.1"].resend).toBeUndefined()
        expect((await upload(7, "7\t2026-11-16 09:05:00\n")).status).toBe(200)
        expect(saved().pushers["127.0.0.1"].pushCursor).toBe("ATTLOG=7;OPERLOG=0")
    })

    it("doesn't listen without a terminal that pushes", async () => {
        config = parseConfig({ server: server.url, devices: [] })
        agent = make()
        await agent.listen(0, "127.0.0.1")
        expect(agent.listeningPort).toBeNull()
        expect(log.lines).toEqual([])
    })
})
