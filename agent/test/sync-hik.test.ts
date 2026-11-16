import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SyncAgent, type Logger } from "../src/sync"
import { parseConfig, type AgentConfig } from "../src/config"
import { emptyState, loadState, type AgentState } from "../src/state"
import { FakeHikDevice, type FakeHikEvent } from "./fake-hik-device"
import { FakeZkDevice } from "./fake-zk-device"
import { FakeServer } from "./fake-server"
import { selfSigned } from "./tls"

/**
 * The agent's rounds reading a Hikvision terminal named in agent.json
 * (ATTENDANCE_PLAN.md §17.4, Phase 4 part 7, PR 302), against a simulated
 * terminal that checks every signature and a stand-in for the website that
 * checks what it's sent against the website's own schemas. Its scans join
 * the same queue as a ZKTeco terminal's; its certificate is pinned on the
 * first read, and a terminal showing another is refused.
 */

const quiet = (): Logger & { lines: string[] } => {
    const lines: string[] = []
    return { lines, info: m => lines.push(`info ${m}`), warn: m => lines.push(`warn ${m}`), error: m => lines.push(`error ${m}`) }
}

const PASSED = 0x4b
const SERIAL = "DS-K1T341AM0020201234"
const scan = (serialNo: number, wall: string, employee = "7", minor = PASSED): FakeHikEvent => ({ major: 5, minor, time: `${wall}+02:00`, serialNo, employeeNoString: employee, name: "Somebody" })

describe("a round reading a Hikvision terminal", () => {
    let tls: ReturnType<typeof selfSigned>, other: ReturnType<typeof selfSigned>
    let device: FakeHikDevice, server: FakeServer, dir: string, config: AgentConfig, state: AgentState, log: ReturnType<typeof quiet>
    const statePath = () => join(dir, "state.json")
    const agent = () => new SyncAgent(config, state, statePath(), log)
    const hikConfig = (port: number, extra: object = {}) => parseConfig({
        server: server.url, sendFrom: "2026-11-01",
        devices: [{ protocol: "hikvision", host: "127.0.0.1", port, user: "agent", password: "Correct Horse 9", name: "Lobby", ...extra }],
    })
    const remembered = () => Object.values(loadState(statePath()).devices)[0]

    beforeAll(() => {
        tls = selfSigned()
        other = selfSigned("DS-K1T341AM-B")
    })
    beforeEach(async () => {
        device = new FakeHikDevice({ localTime: "2026-11-16T13:00:00+02:00" })
        server = new FakeServer()
        await server.start()
        dir = mkdtempSync(join(tmpdir(), "agent-hik-"))
        state = emptyState()
        log = quiet()
    })
    afterEach(async () => {
        await device.stop()
        await server.stop()
    })

    it("reads it over HTTPS, pins its certificate, reports it with its protocol, and delivers its passed checks: then only what is newer", async () => {
        config = hikConfig(await device.start(tls))
        await agent().enrol("K7QD-2MXP")
        // A scan before sendFrom, two passed checks, a failed attempt, and a card issued to nobody.
        device.state.events = [scan(1, "2026-10-30T09:00:00"), scan(2, "2026-11-16T09:05:00"), scan(3, "2026-11-16T09:06:00", "8"), scan(4, "2026-11-16T09:07:00", "9", 0x27), scan(5, "2026-11-16T09:08:00", "")]
        const first = await agent().round()
        expect(first).toMatchObject({ queued: 2, delivered: 2, refused: 0, unreachable: [], stopped: null })
        expect([...server.stored.values()]).toEqual([
            { serialNumber: SERIAL, userNumber: "7", at: "2026-11-16T09:05:00" },
            { serialNumber: SERIAL, userNumber: "8", at: "2026-11-16T09:06:00" },
        ])
        expect(server.heartbeats[0].devices).toEqual([{
            serialNumber: SERIAL, name: "Lobby", model: "DS-K1T341AM", firmware: "V3.2.30 build 220727", protocol: "HIKVISION", reachable: true, clock: "2026-11-16T13:00:00",
        }])
        // Pinned on the first read, and the log says which.
        expect(remembered()).toMatchObject({ serialNumber: SERIAL, certificate: tls.fingerprint, hikCursor: { serialNo: 5, time: "2026-11-16T09:08:00+02:00" } })
        expect(log.lines.some(l => l.includes(tls.fingerprint))).toBe(true)
        // Nothing new: nothing sent. Then only the new one.
        expect(await agent().round()).toMatchObject({ queued: 0, delivered: 0 })
        device.state.events.push(scan(6, "2026-11-16T17:01:00"))
        expect(await agent().round()).toMatchObject({ queued: 1, delivered: 1 })
        expect([...server.stored.values()].at(-1)).toEqual({ serialNumber: SERIAL, userNumber: "7", at: "2026-11-16T17:01:00" })
        expect(loadState(statePath()).queue).toEqual([])
        // Its password never goes into the state, the log or anything sent.
        const everything = JSON.stringify([loadState(statePath()), log.lines, server.heartbeats])
        expect(everything).not.toContain("Correct Horse 9")
    })

    it("refuses a terminal showing another certificate than the one pinned, sends it nothing, and says what to do if it's the same terminal", async () => {
        const port = await device.start(tls)
        config = hikConfig(port)
        await agent().enrol("K7QD-2MXP")
        device.state.events = [scan(1, "2026-11-16T09:05:00")]
        expect(await agent().round()).toMatchObject({ delivered: 1 })
        // Another machine answers at its address, with a certificate of its own.
        await device.stop()
        device = new FakeHikDevice({ localTime: "2026-11-16T13:00:00+02:00", events: [scan(2, "2026-11-16T09:30:00")] })
        await device.start(other, port)
        const round = await agent().round()
        expect(round).toMatchObject({ queued: 0, unreachable: [`127.0.0.1:${port}`] })
        expect(device.seen).toEqual([])
        expect(server.heartbeats.at(-1).devices).toEqual([{ serialNumber: SERIAL, protocol: "HIKVISION", reachable: false, error: expect.stringMatching(/^HIK_CERTIFICATE_CHANGED/) }])
        expect(remembered().certificate).toBe(tls.fingerprint)
        expect(log.lines.some(l => l.includes("nizmo-agent trust 127.0.0.1"))).toBe(true)
    })

    // Codex on PR 302: the pin saved on the first read holds for the rest of that round too.
    it("refuses another certificate later in the very round that pinned the first, and reads none of its events", async () => {
        device = new FakeHikDevice({ localTime: "2026-11-16T13:00:00+02:00", events: [scan(1, "2026-11-16T09:05:00")], renewAfter: { path: "/ISAPI/System/deviceInfo", cert: other.cert, key: other.key } })
        const port = await device.start(tls)
        config = hikConfig(port)
        await agent().enrol("K7QD-2MXP")
        expect(await agent().round()).toMatchObject({ queued: 0, delivered: 0, unreachable: [`127.0.0.1:${port}`] })
        expect(device.seen.filter(r => r.status === 200).map(r => r.path)).toEqual(["/ISAPI/System/deviceInfo"])
        expect(remembered().certificate).toBe(tls.fingerprint)
        expect(server.stored.size).toBe(0)
    })

    it("reads one over HTTP when it says so, with nothing to pin", async () => {
        config = hikConfig(await device.start(), { https: false })
        await agent().enrol("K7QD-2MXP")
        device.state.events = [scan(1, "2026-11-16T09:05:00")]
        expect(await agent().round()).toMatchObject({ delivered: 1 })
        expect(remembered().certificate ?? null).toBeNull()
    })

    it("reports one it can't sign in to by the serial number it last had, with the terminal's refusal", async () => {
        config = hikConfig(await device.start(tls))
        await agent().enrol("K7QD-2MXP")
        await agent().round()
        device.state.password = "Changed on the terminal"
        expect((await agent().round()).unreachable).toHaveLength(1)
        expect(server.heartbeats.at(-1).devices[0]).toMatchObject({ serialNumber: SERIAL, protocol: "HIKVISION", reachable: false, error: expect.stringMatching(/^HIK_AUTH_FAILED/) })
    })

    it("reads a different terminal at the same address from the start of its events", async () => {
        config = hikConfig(await device.start(), { https: false })
        await agent().enrol("K7QD-2MXP")
        device.state.events = [scan(40, "2026-11-16T09:05:00")]
        await agent().round()
        device.state.serialNumber = "DS-K1T341AM0020209999"
        device.state.events = [scan(3, "2026-11-16T09:30:00", "12")]
        expect(await agent().round()).toMatchObject({ queued: 1, delivered: 1 })
        expect(log.lines.some(l => l.includes("is now terminal DS-K1T341AM0020209999"))).toBe(true)
    })

    it("sends what it has read of one set straight to Nizmo, then reads no more of its events, and still names it", async () => {
        config = hikConfig(await device.start(tls))
        await agent().enrol("K7QD-2MXP")
        device.state.events = [scan(1, "2026-11-16T09:05:00")]
        await agent().round()
        server.devices.set(SERIAL, { state: "DIRECT", mode: "ANY" })
        await agent().round()
        device.state.events.push(scan(2, "2026-11-16T10:00:00"))
        const before = device.seen.length
        expect(await agent().round()).toMatchObject({ queued: 0 })
        expect(device.seen.slice(before).some(r => r.path.startsWith("/ISAPI/AccessControl/AcsEvent"))).toBe(false)
        expect(server.heartbeats.at(-1).devices[0]).toMatchObject({ serialNumber: SERIAL, protocol: "HIKVISION", reachable: true })
        // Set back to this agent: read on from where it stopped.
        server.devices.set(SERIAL, { state: "ACTIVE", mode: "ANY" })
        await agent().round()
        expect(await agent().round()).toMatchObject({ queued: 1, delivered: 1 })
    })

    it("reads its events again from sendFrom once that is moved earlier", async () => {
        config = hikConfig(await device.start(tls))
        await agent().enrol("K7QD-2MXP")
        device.state.events = [scan(1, "2026-10-20T09:00:00"), scan(2, "2026-11-16T09:05:00")]
        expect(await agent().round()).toMatchObject({ queued: 1 })
        config = { ...config, sendFrom: "2026-10-01" }
        expect(await agent().round()).toMatchObject({ queued: 2, delivered: 1, duplicates: 1 })
        expect(await agent().round()).toMatchObject({ queued: 0 })
    })

    it("reads a ZKTeco terminal and a Hikvision one in the same round, each reported with its protocol", async () => {
        const zk = new FakeZkDevice({ serialNumber: "ZK-A1" })
        const zkPort = await zk.start()
        try {
            const hikPort = await device.start(tls)
            config = parseConfig({
                server: server.url, sendFrom: "2026-11-01", clearWhenFull: true, clearAtRatio: 0.5,
                devices: [{ host: "127.0.0.1", port: zkPort }, { protocol: "hikvision", host: "127.0.0.1", port: hikPort, user: "agent", password: "Correct Horse 9" }],
            })
            await agent().enrol("K7QD-2MXP")
            zk.scan("7", "2026-11-16T08:00:00")
            device.state.events = [scan(1, "2026-11-16T09:05:00", "8")]
            expect(await agent().round()).toMatchObject({ queued: 2, delivered: 2, cleared: [] })
            expect(server.heartbeats[0].devices.map((d: { serialNumber: string; protocol: string }) => [d.serialNumber, d.protocol])).toEqual([["ZK-A1", "ZKTECO"], [SERIAL, "HIKVISION"]])
        } finally {
            await zk.stop()
        }
    })
})
