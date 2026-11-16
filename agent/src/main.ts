import { join } from "node:path"
import { ConfigError, loadConfig, type HikDeviceConfig } from "./config"
import { fileLogger } from "./log"
import { loadState, saveState } from "./state"
import { LockedError, acquireLock } from "./lock"
import { SyncAgent } from "./sync"
import { HikClient, HikError } from "./hik/client"
import { readSecret } from "./prompt"
import { withDevice } from "./zk/client"
import { AGENT_VERSION } from "./version"

/**
 * nizmo-agent — the Local Sync Agent (ATTENDANCE_PLAN.md §17).
 *
 *   nizmo-agent probe <address> [port] [password]   read a ZKTeco terminal, send nothing
 *   nizmo-agent probe hikvision <address> <user>    read a Hikvision terminal, asking for the password
 *   nizmo-agent trust <address> [port]              pin a Hikvision terminal's renewed certificate
 *   nizmo-agent enrol <code>                        connect this PC to the company
 *   nizmo-agent check                               one round, then stop
 *   nizmo-agent run                                 keep going (what the service runs)
 *
 * Its files live in NIZMO_AGENT_HOME, or beside the program: agent.json
 * (set up by hand), state.json (written by the agent; holds its token) and
 * logs/agent.log.
 */

export const HELP = `Nizmo attendance agent ${AGENT_VERSION}

  nizmo-agent probe <address> [port] [password]
      Reads one ZKTeco terminal and shows what it is and how many scans it holds. Sends nothing.
  nizmo-agent probe hikvision <address> <user> [port] [--http]
      Reads one Hikvision terminal with the user made on it for the agent, asking for that
      user's password without showing it. Shows what it is, its clock and, over HTTPS, its
      certificate. --http reads one whose HTTPS is off. Sends nothing.
  nizmo-agent trust <address> [port]
      For a Hikvision terminal in agent.json whose certificate was renewed, as after a reset
      or a firmware update: shows its serial number and new certificate, and trusts it from
      now on. Stop the service first.
  nizmo-agent enrol <code>
      Connects this PC to your company with the code from Company Settings → Attendance.
  nizmo-agent check
      Reads the terminals in agent.json and sends their new scans once.
  nizmo-agent run
      Keeps reading and sending every pollSeconds. This is what the Windows service runs.
`

function home(): string {
    if (process.env.NIZMO_AGENT_HOME) return process.env.NIZMO_AGENT_HOME
    // Beside the program when packaged; the current folder when run with node.
    const exe = process.execPath.toLowerCase()
    return exe.endsWith("nizmo-agent.exe") ? join(process.execPath, "..") : process.cwd()
}

/**
 * Waits, or stops waiting when the service is stopped. The listener goes
 * when the wait ends either way: one left behind each round would grow
 * forever in a service that runs for months (review on #18).
 */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>(resolve => {
        const done = () => {
            clearTimeout(timer)
            signal.removeEventListener("abort", done)
            resolve()
        }
        const timer = setTimeout(done, ms)
        signal.addEventListener("abort", done, { once: true })
    })
}

/** What main asks of the person at the console; replaced in tests. */
export type Deps = { secret?: (prompt: string) => Promise<string> }

export async function main(argv: string[], deps: Deps = {}): Promise<number> {
    const [command, ...args] = argv
    const dir = home()
    const paths = { config: join(dir, "agent.json"), state: join(dir, "state.json"), log: join(dir, "logs", "agent.log") }

    if (!command || command === "help" || command === "--help") { process.stdout.write(HELP); return 0 }
    if (command === "version" || command === "--version") { process.stdout.write(`${AGENT_VERSION}\n`); return 0 }

    if (command === "probe" && args[0]?.toLowerCase() === "hikvision") return probeHikvision(args.slice(1), deps.secret ?? readSecret)

    if (command === "probe") {
        const [host, port, password] = args
        if (!host) { process.stderr.write("Give the terminal's address, such as: nizmo-agent probe 192.168.1.20\n"); return 2 }
        const info = await withDevice({ host, port: port ? Number(port) : 4370, password: password ? Number(password) : 0 }, zk => zk.info())
        process.stdout.write(`${JSON.stringify(info, null, 2)}\n`)
        return 0
    }

    const log = fileLogger(paths.log)
    let config
    try {
        config = loadConfig(paths.config)
    } catch (e) {
        if (e instanceof ConfigError) { log.error(e.message); return 2 }
        throw e
    }
    if (!["enrol", "enroll", "check", "run", "trust"].includes(command)) {
        process.stderr.write(HELP)
        return 2
    }
    let lock: { release(): void }
    try {
        lock = acquireLock(join(dir, "agent.lock"))
    } catch (e) {
        if (!(e instanceof LockedError)) throw e
        log.error(`${e.message} If the service is running, stop it first: nizmo-agent-service.exe stop`)
        return 3
    }
    try {
        return await locked(command, args, config, paths, log)
    } finally {
        lock.release()
    }
}

/** What the commands that use the state do, holding the folder's lock. */
async function locked(command: string, args: string[], config: ReturnType<typeof loadConfig>, paths: { state: string }, log: ReturnType<typeof fileLogger>): Promise<number> {
    // Read under the lock, so nothing else has it half-changed.
    const state = loadState(paths.state)

    if (command === "enrol" || command === "enroll") {
        const [code] = args
        if (!code) { log.error("Give the code shown in Company Settings → Attendance, such as: nizmo-agent enrol K7QD-2MXP"); return 2 }
        const enrolled = await new SyncAgent(config, state, paths.state, log).enrol(code)
        log.info(`Enrolled as "${enrolled.name}" for ${enrolled.company}. Start the service, or run: nizmo-agent run`)
        return 0
    }

    if (command === "trust") return trust(args, config, state, paths.state, log)

    if (command === "check") {
        const result = await new SyncAgent(config, state, paths.state, log).round()
        log.info(`Round: ${JSON.stringify(result)}`)
        return result.stopped ? 1 : 0
    }

    if (command === "run") {
        const stop = new AbortController()
        for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { log.info(`Stopping (${signal}).`); stop.abort() })
        log.info(`Agent ${AGENT_VERSION} started: ${config.devices.length} terminal(s), every ${config.pollSeconds} s, sending to ${config.server}.`)
        const agent = new SyncAgent(config, state, paths.state, log)
        while (!stop.signal.aborted) {
            let wait = config.pollSeconds * 1000
            try {
                const r = await agent.round()
                if (r.queued || r.delivered || r.refused || r.cleared.length) log.info(`Read ${r.read}, queued ${r.queued}, delivered ${r.delivered}, already there ${r.duplicates}, refused ${r.refused}${r.cleared.length ? `, cleared ${r.cleared.join(", ")}` : ""}.`)
                // Not enrolled: there is nothing to do until someone is, so ask less often.
                if (r.stopped === "REENROL") wait = Math.max(wait, 10 * 60_000)
            } catch (e) {
                log.error(`Round failed: ${(e as Error).stack ?? e}`)
            }
            // A little jitter, so many offices do not all arrive on the same second.
            await sleep(wait + Math.floor(Math.random() * 5000), stop.signal)
        }
        return 0
    }

    return 2
}

/**
 * Reads one Hikvision terminal with the user made on it for the agent, and
 * shows who it is, its clock and, over HTTPS, its certificate's fingerprint.
 * Sends nothing, and keeps nothing: agent.json and the state are not read.
 * The password is asked for, never taken from the command line, where the
 * console's history would keep it (§17.4, PR 302).
 */
async function probeHikvision(args: string[], secret: (prompt: string) => Promise<string>): Promise<number> {
    const http = args.includes("--http")
    const [host, user, port] = args.filter(a => a !== "--http")
    if (!host || !user) {
        process.stderr.write("Give the terminal's address and the user made on it for the agent, such as: nizmo-agent probe hikvision 192.168.1.30 nizmo-agent\n")
        return 2
    }
    const password = await secret(`Password for ${user}: `)
    const client = new HikClient({ host, port: port ? Number(port) : undefined, https: !http, user, password, pin: null })
    let info
    try {
        info = await client.info()
    } catch (e) {
        if (!http && e instanceof HikError && e.code === "HIK_UNREACHABLE") process.stderr.write("Nothing answered over HTTPS. If the terminal's HTTPS is off, add --http.\n")
        throw e
    }
    const clock = await client.clock()
    process.stdout.write(`${JSON.stringify({ ...info, clock: clock.wall, https: !http, certificate: http ? null : client.seenFingerprint }, null, 2)}\n`)
    return 0
}

/**
 * Trusts a Hikvision terminal's renewed certificate (§17.4, PR 302): one
 * named in agent.json and read over HTTPS, at this address and, where the
 * office has several there, this port. It's read once with the user in
 * agent.json, whatever certificate it shows, and that one is pinned from
 * now on. Its serial number is shown, to be sure it is the terminal meant;
 * a round reading another terminal there reads its events from the start.
 */
async function trust(args: string[], config: ReturnType<typeof loadConfig>, state: ReturnType<typeof loadState>, statePath: string, log: ReturnType<typeof fileLogger>): Promise<number> {
    const [host, port] = args
    if (!host) { log.error("Give the terminal's address, as in agent.json, such as: nizmo-agent trust 192.168.1.30"); return 2 }
    const named = config.devices.filter((d): d is HikDeviceConfig => d.protocol === "hikvision" && d.host === host && (!port || d.port === Number(port)))
    if (named.length === 0) { log.error(`No Hikvision terminal at ${host}${port ? ` port ${port}` : ""} in agent.json.`); return 2 }
    if (named.length > 1) { log.error(`Several Hikvision terminals at ${host} in agent.json: give the port too, such as: nizmo-agent trust ${host} ${named[0].port}`); return 2 }
    const d = named[0]
    if (!d.https) { log.error(`Terminal ${d.name ?? host} is read over HTTP, there is no certificate to trust.`); return 2 }
    const client = new HikClient({ host: d.host, port: d.port, https: true, user: d.user, password: d.password, pin: null })
    const info = await client.info()
    const key = `${d.host}:${d.port}`
    const remembered = (state.devices[key] ??= { serialNumber: null, cursor: { count: 0, lastKey: null } })
    if (remembered.serialNumber && remembered.serialNumber !== info.serialNumber) {
        log.warn(`${key} is now terminal ${info.serialNumber}, not ${remembered.serialNumber}. Its events are read from the start.`)
    }
    remembered.certificate = client.seenFingerprint
    saveState(statePath, state)
    log.info(`Trusting terminal ${info.serialNumber} at ${key}, certificate ${client.seenFingerprint}, from now on.`)
    return 0
}

// Run when started as a program, not when imported by a test.
if (typeof require !== "undefined" && require.main === module) {
    main(process.argv.slice(2)).then(code => process.exit(code), e => {
        process.stderr.write(`${(e as Error).message}\n`)
        process.exit(1)
    })
}
