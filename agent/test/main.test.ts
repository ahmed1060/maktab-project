import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getEventListeners } from "node:events"
import { spawn } from "node:child_process"
import { main, sleep } from "../src/main"
import { FakeZkDevice } from "./fake-zk-device"
import { FakeServer } from "./fake-server"

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
        device.scan("7", `${new Date().toISOString().slice(0, 10)}T09:00:00`)
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
