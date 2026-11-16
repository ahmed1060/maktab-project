import { describe, it, expect, afterEach, beforeAll, vi } from "vitest"
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getEventListeners } from "node:events"
import { spawn } from "node:child_process"
import { main, sleep, HELP } from "../src/main"
import { AGENT_VERSION } from "../src/version"
import { FakeZkDevice } from "./fake-zk-device"
import { FakeHikDevice, type FakeHikEvent } from "./fake-hik-device"
import { FakeServer } from "./fake-server"
import { selfSigned } from "./tls"

/** The command line, as an installer uses it: probe, enrol, check. */
describe("nizmo-agent", () => {
    let device: FakeZkDevice, server: FakeServer
    afterEach(async () => { await device?.stop(); await server?.stop(); delete process.env.NIZMO_AGENT_HOME })

    it("probes a terminal, enrols with a code, and sends a round", async () => {
        device = new FakeZkDevice({ serialNumber: "ZK-CLI" })
        const port = await device.start()
        server = new FakeServer()
        await server.start()
        const home = mkdtempSync(join(tmpdir(), "agent-home-"))
        process.env.NIZMO_AGENT_HOME = home

        expect(await main(["probe", "127.0.0.1", String(port)])).toBe(0)
        // No config yet: says what to do, and stops.
        expect(await main(["enrol", "K7QD-2MXP"])).toBe(2)
        writeFileSync(join(home, "agent.json"), JSON.stringify({ server: server.url, devices: [{ host: "127.0.0.1", port }] }))
        expect(await main(["enrol"])).toBe(2)
        expect(await main(["enrol", "k7qd-2mxp".toUpperCase()])).toBe(0)
        expect(JSON.parse(readFileSync(join(home, "state.json"), "utf8")).token).toBe("mka_1")
        // On the company's day, as the agent sends from the first of the company's
        // month: on UTC's, at a month's end in UTC it's already the next month in
        // Cairo, and the check-in was before the agent's start (found 2026-10-31).
        const companyToday = new Intl.DateTimeFormat("en-CA", { timeZone: server.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
        device.scan("7", `${companyToday}T09:00:00`)
        expect(await main(["check"])).toBe(0)
        expect(server.stored.size).toBe(1)
        expect(existsSync(join(home, "logs", "agent.log"))).toBe(true)
        expect(await main(["nonsense"])).toBe(2)
    })

    it("will not enrol while the service holds the folder, and takes over a lock left by one that has gone (review on #18)", async () => {
        device = new FakeZkDevice()
        const port = await device.start()
        server = new FakeServer()
        await server.start()
        const home = mkdtempSync(join(tmpdir(), "agent-home-"))
        process.env.NIZMO_AGENT_HOME = home
        writeFileSync(join(home, "agent.json"), JSON.stringify({ server: server.url, devices: [{ host: "127.0.0.1", port }] }))
        // The service, standing in: a live process holding the lock.
        const service = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"])
        writeFileSync(join(home, "agent.lock"), String(service.pid))
        expect(await main(["enrol", "K7QD-2MXP"])).toBe(3)
        expect(existsSync(join(home, "state.json"))).toBe(false)
        expect(readFileSync(join(home, "logs", "agent.log"), "utf8")).toContain("stop it first")
        // The service stopped without tidying up: its lock is taken over.
        service.kill()
        await new Promise(r => service.once("exit", r))
        expect(await main(["enrol", "K7QD-2MXP"])).toBe(0)
        expect(existsSync(join(home, "agent.lock"))).toBe(false)
    })

    it("leaves nothing behind after each wait between rounds (review on #18)", async () => {
        const stop = new AbortController()
        for (let i = 0; i < 5; i++) await sleep(1, stop.signal)
        expect(getEventListeners(stop.signal, "abort")).toHaveLength(0)
        const waiting = sleep(60_000, stop.signal)
        stop.abort()
        await waiting
    })
})

/** What it says on the command line, and nothing else (PR 302). */
function captured() {
    let out = ""
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => { out += String(chunk); return true })
    return { text: () => out, restore: () => spy.mockRestore() }
}

/** A Hikvision terminal from the command line: probe, and trust for a renewed certificate (ATTENDANCE_PLAN.md §17.4, PR 302). */
describe("nizmo-agent and a Hikvision terminal", () => {
    let hik: FakeHikDevice, server: FakeServer, tls: ReturnType<typeof selfSigned>, renewed: ReturnType<typeof selfSigned>
    const SERIAL = "DS-K1T341AM0020201234"
    const scan = (serialNo: number, wall: string): FakeHikEvent => ({ major: 5, minor: 0x4b, time: `${wall}+02:00`, serialNo, employeeNoString: "7" })
    const typed = (password: string, asked: string[] = []) => ({ secret: async (prompt: string) => { asked.push(prompt); return password } })
    beforeAll(() => {
        tls = selfSigned()
        renewed = selfSigned("DS-K1T341AM-renewed")
    })
    afterEach(async () => { await hik?.stop(); await server?.stop(); delete process.env.NIZMO_AGENT_HOME })

    it("probes one, asking for the agent user's password rather than taking it from the command line, and sends nothing", async () => {
        hik = new FakeHikDevice({ localTime: "2026-11-16T13:00:00+02:00", events: [scan(1, "2026-11-16T09:05:00")] })
        const port = await hik.start(tls)
        const asked: string[] = []
        const out = captured()
        try {
            expect(await main(["probe", "hikvision", "127.0.0.1", "agent", String(port)], typed("Correct Horse 9", asked))).toBe(0)
        } finally {
            out.restore()
        }
        expect(asked).toEqual(["Password for agent: "])
        expect(JSON.parse(out.text())).toEqual({
            serialNumber: SERIAL, model: "DS-K1T341AM", name: "Lobby", firmware: "V3.2.30 build 220727", clock: "2026-11-16T13:00:00", https: true, certificate: tls.fingerprint,
        })
        expect(out.text()).not.toContain("Correct Horse 9")
        // Who it is and its clock: none of its events, and nothing kept.
        expect(hik.seen.filter(r => r.status === 200).map(r => r.path)).toEqual(["/ISAPI/System/deviceInfo", "/ISAPI/System/time"])
    })

    it("probes one over HTTP with --http, and says what's missing", async () => {
        hik = new FakeHikDevice()
        const port = await hik.start()
        const out = captured()
        try {
            expect(await main(["probe", "hikvision", "127.0.0.1", "agent", String(port), "--http"], typed("Correct Horse 9"))).toBe(0)
            expect(JSON.parse(out.text())).toMatchObject({ serialNumber: SERIAL, https: false, certificate: null })
        } finally {
            out.restore()
        }
        const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
        try {
            expect(await main(["probe", "hikvision", "127.0.0.1"], typed("x"))).toBe(2)
            expect(await main(["probe", "hikvision"], typed("x"))).toBe(2)
        } finally {
            err.mockRestore()
        }
        await expect(main(["probe", "hikvision", "127.0.0.1", "agent", String(port), "--http"], typed("wrong"))).rejects.toThrow("HIK_AUTH_FAILED")
        // Over HTTPS to one whose HTTPS is off: nothing answers there, and it says what to add.
        const said = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
        try {
            await hik.stop()
            await expect(main(["probe", "hikvision", "127.0.0.1", "agent", String(port)], typed("Correct Horse 9"))).rejects.toThrow("HIK_UNREACHABLE")
            expect(said.mock.calls.map(c => String(c[0])).join("")).toContain("add --http")
        } finally {
            said.mockRestore()
        }
    })

    it("trusts a terminal's renewed certificate, with the service stopped, and reads it again", async () => {
        hik = new FakeHikDevice({ localTime: "2026-11-16T13:00:00+02:00", events: [scan(1, "2026-11-16T09:05:00")] })
        const port = await hik.start(tls)
        server = new FakeServer()
        await server.start()
        const home = mkdtempSync(join(tmpdir(), "agent-home-"))
        process.env.NIZMO_AGENT_HOME = home
        writeFileSync(join(home, "agent.json"), JSON.stringify({
            server: server.url, sendFrom: "2026-11-01",
            devices: [{ protocol: "hikvision", host: "127.0.0.1", port, user: "agent", password: "Correct Horse 9", name: "Lobby" }],
        }))
        const state = () => JSON.parse(readFileSync(join(home, "state.json"), "utf8"))
        const out = captured()
        try {
            expect(await main(["enrol", "K7QD-2MXP"])).toBe(0)
            expect(await main(["check"])).toBe(0)
            expect(server.stored.size).toBe(1)
            expect(state().devices[`127.0.0.1:${port}`].certificate).toBe(tls.fingerprint)

            // Reset, its certificate renewed: refused, until it's trusted.
            await hik.stop()
            hik = new FakeHikDevice({ localTime: "2026-11-16T13:00:00+02:00", events: [scan(1, "2026-11-16T09:05:00"), scan(2, "2026-11-16T10:00:00")] })
            await hik.start(renewed, port)
            expect(await main(["check"])).toBe(0)
            expect(server.stored.size).toBe(1)
            expect(readFileSync(join(home, "logs", "agent.log"), "utf8")).toContain("HIK_CERTIFICATE_CHANGED")

            expect(await main(["trust", "127.0.0.1"])).toBe(0)
            expect(state().devices[`127.0.0.1:${port}`].certificate).toBe(renewed.fingerprint)
            expect(out.text()).toContain(SERIAL)
            expect(out.text()).toContain(renewed.fingerprint)
            expect(await main(["check"])).toBe(0)
            expect(server.stored.size).toBe(2)

            // Only a Hikvision terminal in agent.json, over HTTPS, can be trusted.
            expect(await main(["trust"])).toBe(2)
            expect(await main(["trust", "192.0.2.1"])).toBe(2)
        } finally {
            out.restore()
        }
        writeFileSync(join(home, "agent.json"), JSON.stringify({
            server: server.url, devices: [{ protocol: "hikvision", host: "127.0.0.1", port, user: "agent", password: "Correct Horse 9", https: false }],
        }))
        const quietly = captured()
        try {
            expect(await main(["trust", "127.0.0.1"])).toBe(2)
        } finally {
            quietly.restore()
        }
        expect(readFileSync(join(home, "logs", "agent.log"), "utf8")).toContain("over HTTP, there is no certificate to trust")
    })

    it("says so in its help, and is 0.3.0, the version that reads Hikvision, in its package too", () => {
        expect(HELP).toContain("nizmo-agent probe hikvision <address> <user> [port] [--http]")
        expect(HELP).toContain("nizmo-agent trust <address> [port]")
        expect(AGENT_VERSION).toBe("0.3.0")
        expect(JSON.parse(readFileSync("agent/package.json", "utf8")).version).toBe(AGENT_VERSION)
        const lock = JSON.parse(readFileSync("agent/package-lock.json", "utf8"))
        expect([lock.version, lock.packages[""].version]).toEqual([AGENT_VERSION, AGENT_VERSION])
        // As the README an office reads tells it.
        const readme = readFileSync("agent/README.md", "utf8")
        for (const said of ["nizmo-agent.exe probe hikvision 192.168.1.30 nizmo-agent", "nizmo-agent.exe trust 192.168.1.30", "HIK_CERTIFICATE_CHANGED", "from version 0.3.0"]) expect(readme).toContain(said)
        // As the setup guide names it, written in PR 301 (lib/attendance/setup-guide.ts).
        expect(readFileSync("lib/attendance/setup-guide.ts", "utf8")).toContain('"nizmo-agent.exe probe hikvision TERMINAL-ADDRESS AGENT-USER"')
    })
})
