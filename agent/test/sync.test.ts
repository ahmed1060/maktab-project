import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SyncAgent, newRecords, firstOfMonthIn, type Logger, type DeviceAccess } from "../src/sync"
import { parseConfig, type AgentConfig } from "../src/config"
import { emptyState, loadState, type AgentState } from "../src/state"
import { withDevice } from "../src/zk/client"
import { FakeZkDevice } from "./fake-zk-device"
import { FakeServer } from "./fake-server"

/**
 * One round of the agent against a simulated terminal and a stand-in for the
 * website. What matters most: no punch is lost — not when the network drops,
 * not when the server refuses for now, not when the agent restarts — and
 * none is sent twice to no purpose.
 */

const quiet = (): Logger & { lines: string[] } => {
    const lines: string[] = []
    return { lines, info: m => lines.push(`info ${m}`), warn: m => lines.push(`warn ${m}`), error: m => lines.push(`error ${m}`) }
}

describe("which records are new", () => {
    const r = (n: number) => ({ uid: n, userNumber: String(n), at: `2026-10-01T09:00:${String(n).padStart(2, "0")}`, status: 1, punch: 0 })
    it("are those past the cursor, while the log starts as remembered", () => {
        const log = [r(1), r(2), r(3)]
        const first = newRecords(log, { count: 0, lastKey: null })
        expect(first.fresh).toEqual(log)
        expect(newRecords([...log, r(4)], first.cursor).fresh).toEqual([r(4)])
        expect(newRecords(log, first.cursor).fresh).toEqual([])
    })
    it("are all of them, once the log has been cleared or rewritten at the terminal", () => {
        const { cursor } = newRecords([r(1), r(2), r(3)], { count: 0, lastKey: null })
        expect(newRecords([r(4)], cursor).fresh).toEqual([r(4)])
        expect(newRecords([r(9), r(8), r(7)], cursor).fresh).toEqual([r(9), r(8), r(7)])
    })
})

describe("a round of the agent", () => {
    let device: FakeZkDevice, server: FakeServer, dir: string, config: AgentConfig, state: AgentState, log: ReturnType<typeof quiet>
    const statePath = () => join(dir, "state.json")
    const agent = (access: DeviceAccess = withDevice) => new SyncAgent(config, state, statePath(), log, access)
    const at = (day: string, time: string) => `${day}T${time}`
    const today = firstOfMonthIn("Africa/Cairo").slice(0, 8) + "02"

    beforeEach(async () => {
        device = new FakeZkDevice({ serialNumber: "ZK-A1" })
        server = new FakeServer()
        const port = await device.start()
        await server.start()
        dir = mkdtempSync(join(tmpdir(), "agent-"))
        config = parseConfig({ server: server.url, devices: [{ host: "127.0.0.1", port, name: "Front door" }] })
        state = emptyState()
        log = quiet()
    })
    afterEach(async () => {
        await device.stop()
        await server.stop()
    })

    it("enrols once with the code it was given, and starts from this month", async () => {
        await expect(agent().enrol("WRONG-CODE")).rejects.toThrow("ENROLMENT_CODE_INVALID")
        const enrolled = await agent().enrol("K7QD-2MXP")
        expect(enrolled.company).toBe("Sweep Co")
        const saved = loadState(statePath())
        expect(saved).toMatchObject({ token: "mka_1", company: "Sweep Co", timeZone: "Africa/Cairo", sendFrom: firstOfMonthIn("Africa/Cairo"), needsEnrolment: false })
    })

    it("starts from the company's month by the server's clock, not this PC's (review on #18)", async () => {
        // 23:30 on 30 November in UTC is already 1 December in Cairo.
        server.serverDate = new Date("2026-11-30T23:30:00Z")
        await agent().enrol("K7QD-2MXP")
        expect(loadState(statePath()).sendFrom).toBe("2026-12-01")
    })

    it("reads the terminal, reports it, and delivers its new punches — then only what is newer", async () => {
        await agent().enrol("K7QD-2MXP")
        device.scan("7", at(today, "09:05:00"))
        device.scan("8", at(today, "09:07:00"))
        const first = await agent().round()
        expect(first).toMatchObject({ read: 2, queued: 2, delivered: 2, duplicates: 0, refused: 0, stopped: null })
        expect(server.heartbeats[0].devices[0]).toMatchObject({ serialNumber: "ZK-A1", name: "Front door", model: "Simulated K40", reachable: true, recordCount: 2, recordCapacity: 100000 })
        expect(server.heartbeats[0]).toMatchObject({ agentVersion: expect.any(String), queueDepth: 2 })

        expect(await agent().round()).toMatchObject({ read: 2, queued: 0, delivered: 0 })
        device.scan("7", at(today, "17:01:00"))
        expect(await agent().round()).toMatchObject({ queued: 1, delivered: 1 })
        expect([...server.stored.values()].map(p => [p.userNumber, p.at])).toEqual([["7", at(today, "09:05:00")], ["8", at(today, "09:07:00")], ["7", at(today, "17:01:00")]])
        expect(loadState(statePath()).queue).toEqual([])
    })

    it("sends nothing from before the month it was enrolled", async () => {
        await agent().enrol("K7QD-2MXP")
        device.scan("7", "2025-01-15T09:00:00")
        device.scan("7", at(today, "09:00:00"))
        expect(await agent().round()).toMatchObject({ read: 2, queued: 1, delivered: 1 })
    })

    it("sends the older records once the start is moved earlier (review on #18)", async () => {
        await agent().enrol("K7QD-2MXP")
        device.scan("7", "2025-01-15T09:00:00")
        device.scan("7", at(today, "09:00:00"))
        expect(await agent().round()).toMatchObject({ queued: 1, delivered: 1 })
        config = { ...config, sendFrom: "2025-01-01" }
        expect(await agent().round()).toMatchObject({ queued: 2, delivered: 1, duplicates: 1 })
        expect([...server.stored.values()].map(p => p.at)).toContain("2025-01-15T09:00:00")
        // And not again on the next round.
        expect(await agent().round()).toMatchObject({ queued: 0 })
    })

    it("keeps every punch when the server cannot be reached, and delivers them later", async () => {
        await agent().enrol("K7QD-2MXP")
        for (let i = 0; i < 3; i++) device.scan(String(i), at(today, `09:0${i}:00`))
        server.failPunches = { times: 1, status: 503 }
        expect(await agent().round()).toMatchObject({ queued: 3, delivered: 0, stopped: "NETWORK" })
        // A restart in between: a new agent from what is on disk.
        state = loadState(statePath())
        expect(state.queue).toHaveLength(3)
        expect(await agent().round()).toMatchObject({ queued: 0, delivered: 3, stopped: null })
        expect(server.stored.size).toBe(3)
    })

    it("delivers a large backlog in batches, and counts a resent batch as duplicates", async () => {
        await agent().enrol("K7QD-2MXP")
        const clock = (i: number) => { const s = 8 * 3600 + i * 7; return [s / 3600, (s / 60) % 60, s % 60].map(n => String(Math.floor(n)).padStart(2, "0")).join(":") }
        for (let i = 0; i < 1200; i++) device.scan(String(i % 40), at(today, clock(i)))
        expect(await agent().round()).toMatchObject({ queued: 1200, delivered: 1200 })
        expect(server.batches).toEqual([500, 500, 200])
        // The terminal's log cleared by hand and refilled with the same scans: sent again, stored once.
        state.devices[Object.keys(state.devices)[0]].cursor = { count: 5, lastKey: "nobody|never" }
        expect(await agent().round()).toMatchObject({ queued: 1200, delivered: 0, duplicates: 1200 })
    })

    it("drops a punch refused for good with a warning, and keeps one refused for now", async () => {
        await agent().enrol("K7QD-2MXP")
        server.lockedBefore = at(today, "09:00:00")
        device.scan("7", at(today, "08:00:00"))
        device.scan("7", at(today, "10:00:00"))
        expect(await agent().round()).toMatchObject({ delivered: 1, refused: 1 })
        expect(log.lines.some(l => l.includes("MONTH_LOCKED"))).toBe(true)
        expect(state.queue).toEqual([])

        // A terminal the server has not yet heard of: kept, delivered once it is reported.
        server.devices.clear()
        const queuedOnly: DeviceAccess = async () => { throw new Error("unplugged") }
        state.queue.push({ serialNumber: "ZK-NEW", userNumber: "9", at: at(today, "11:00:00") })
        expect(await agent(queuedOnly).round()).toMatchObject({ delivered: 0, refused: 0 })
        expect(state.queue).toHaveLength(1)
        server.devices.set("ZK-NEW", { state: "ACTIVE", mode: "ANY" })
        expect(await agent(queuedOnly).round()).toMatchObject({ delivered: 1 })
        expect(state.queue).toEqual([])
    })

    it("stops, and says so, once the server no longer accepts its token", async () => {
        await agent().enrol("K7QD-2MXP")
        server.tokens.clear()
        device.scan("7", at(today, "09:00:00"))
        expect(await agent().round()).toMatchObject({ stopped: "REENROL", queued: 1 })
        expect(loadState(statePath())).toMatchObject({ needsEnrolment: true, queue: [{ userNumber: "7" }] })
        // Nothing more is attempted until it is enrolled again.
        expect((await agent().round()).stopped).toBe("REENROL")
        expect(log.lines.filter(l => l.startsWith("error")).length).toBe(2)
    })

    it("rotates its token when asked, and keeps working with the new one", async () => {
        await agent().enrol("K7QD-2MXP")
        server.rotateNext = true
        await agent().round()
        expect(state.token).toBe("mka_2")
        device.scan("7", at(today, "09:00:00"))
        expect(await agent().round()).toMatchObject({ delivered: 1, stopped: null })
        expect(server.tokens).toEqual(new Set(["mka_2"]))
    })

    it("reports a terminal it cannot reach, by the serial number it last had", async () => {
        await agent().enrol("K7QD-2MXP")
        await agent().round()
        await device.stop()
        expect((await agent().round()).unreachable).toHaveLength(1)
        expect(server.heartbeats.at(-1).devices[0]).toMatchObject({ serialNumber: "ZK-A1", reachable: false, error: expect.stringMatching(/ZK_/) })
        await device.start().catch(() => {})
    })

    it("reads a different terminal at the same address from the start of its log", async () => {
        await agent().enrol("K7QD-2MXP")
        device.scan("7", at(today, "09:00:00"))
        await agent().round()
        device.state.serialNumber = "ZK-B2"
        expect(await agent().round()).toMatchObject({ queued: 1, delivered: 1 })
        expect(log.lines.some(l => l.includes("is now terminal ZK-B2"))).toBe(true)
    })

    it("writes its state so that a crash leaves a whole file", async () => {
        await agent().enrol("K7QD-2MXP")
        device.scan("7", at(today, "09:00:00"))
        await agent().round()
        const onDisk = JSON.parse(readFileSync(statePath(), "utf8"))
        expect(onDisk.queue).toEqual([])
        expect(Object.values(onDisk.devices)[0]).toMatchObject({ serialNumber: "ZK-A1", cursor: { count: 1 } })
    })

    describe("clearing a terminal that is nearly full", () => {
        it("clears it once everything is delivered, with the terminal disabled meanwhile", async () => {
            config = { ...config, clearWhenFull: true, clearAtRatio: 0.9 }
            device.state.recordsCapacity = 10
            await agent().enrol("K7QD-2MXP")
            for (let i = 0; i < 9; i++) device.scan(String(i), at(today, `09:0${i}:00`))
            expect(await agent().round()).toMatchObject({ delivered: 9, cleared: [expect.any(String)] })
            expect(device.state.records).toEqual([])
            expect(device.state.disabled).toBe(false)
            // And reads its next scans from the start.
            device.scan("1", at(today, "12:00:00"))
            expect(await agent().round()).toMatchObject({ queued: 1, delivered: 1, cleared: [] })
        })

        it("leaves it alone while anything in it is undelivered, or was scanned since the read", async () => {
            config = { ...config, clearWhenFull: true, clearAtRatio: 0.9 }
            device.state.recordsCapacity = 10
            await agent().enrol("K7QD-2MXP")
            for (let i = 0; i < 9; i++) device.scan(String(i), at(today, `09:0${i}:00`))
            server.failPunches = { times: 1, status: 503 }
            expect((await agent().round()).cleared).toEqual([])
            expect(device.state.records).toHaveLength(9)

            // A scan between the round's read and the clear.
            let calls = 0
            const busy: DeviceAccess = (options, work) => {
                if (++calls === 2) device.scan("late", at(today, "09:30:00"))
                return withDevice(options, work)
            }
            expect(await agent(busy).round()).toMatchObject({ delivered: 9, cleared: [] })
            expect(device.state.records).toHaveLength(10)
            expect(device.state.disabled).toBe(false)
            // Next round delivers it, then clears.
            expect(await agent().round()).toMatchObject({ delivered: 1, cleared: [expect.any(String)] })
        })

        it("switches a terminal back on in a later round if the connection is lost before it was (review on #18)", async () => {
            config = { ...config, clearWhenFull: true, clearAtRatio: 0.9 }
            device.state.recordsCapacity = 10
            await agent().enrol("K7QD-2MXP")
            for (let i = 0; i < 9; i++) device.scan(String(i), at(today, `09:0${i}:00`))
            device.state.dropNextEnable = true
            await agent().round()
            expect(device.state.records).toEqual([])
            expect(device.state.disabled).toBe(true)
            expect(loadState(statePath()).devices[Object.keys(state.devices)[0]].mustEnable).toBe(true)
            // A restart, then the next round: on again before anything else.
            state = loadState(statePath())
            await agent().round()
            expect(device.state.disabled).toBe(false)
            expect(loadState(statePath()).devices[Object.keys(state.devices)[0]].mustEnable).toBe(false)
            expect(device.scan("7", at(today, "12:00:00"))).toBe(true)
        })

        it("is never done to a terminal retired here or in use by another company (review on #18)", async () => {
            config = { ...config, clearWhenFull: true, clearAtRatio: 0.9 }
            device.state.recordsCapacity = 10
            await agent().enrol("K7QD-2MXP")
            for (let i = 0; i < 9; i++) device.scan(String(i), at(today, `09:0${i}:00`))
            server.devices.set("ZK-A1", { state: "RETIRED", mode: "ANY" })
            expect(await agent().round()).toMatchObject({ refused: 9, cleared: [] })
            server.devices.set("ZK-A1", { state: "CLAIMED_ELSEWHERE", mode: "ANY" })
            expect((await agent().round()).cleared).toEqual([])
            expect(device.state.records).toHaveLength(9)
        })

        it("is never done unless switched on", async () => {
            device.state.recordsCapacity = 10
            await agent().enrol("K7QD-2MXP")
            for (let i = 0; i < 9; i++) device.scan(String(i), at(today, `09:0${i}:00`))
            expect((await agent().round()).cleared).toEqual([])
            expect(device.state.records).toHaveLength(9)
        })
    })
})

describe("the config file", () => {
    it("fills in sensible defaults", () => {
        expect(parseConfig({ server: "https://app.example.com/", devices: [{ host: "192.168.1.20" }] })).toEqual({
            server: "https://app.example.com", devices: [{ host: "192.168.1.20", port: 4370, password: 0, name: null }],
            pollSeconds: 60, sendFrom: null, clearWhenFull: false, clearAtRatio: 0.9,
        })
    })
    it("refuses what would be unsafe or cannot work, saying what to fix", () => {
        expect(() => parseConfig({ server: "http://app.example.com", devices: [] })).toThrow("https://")
        expect(parseConfig({ server: "http://localhost:3000", devices: [] }).server).toBe("http://localhost:3000")
        expect(() => parseConfig({ server: "https://x.co", devices: [{}] })).toThrow('"host"')
        expect(() => parseConfig({ server: "https://x.co", devices: [{ host: "a" }, { host: "a", port: 4370 }] })).toThrow("twice")
        expect(() => parseConfig({ server: "https://x.co", devices: [], pollSeconds: 5 })).toThrow("pollSeconds")
        expect(() => parseConfig({ server: "https://x.co", devices: [{ host: "a", password: "secret" }] })).toThrow("numeric")
    })
})
