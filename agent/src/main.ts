import { join } from "node:path"
import { ConfigError, loadConfig } from "./config"
import { fileLogger } from "./log"
import { loadState } from "./state"
import { SyncAgent } from "./sync"
import { withDevice } from "./zk/client"
import { AGENT_VERSION } from "./version"

/**
 * nizmo-agent — the Local Sync Agent (ATTENDANCE_PLAN.md §17).
 *
 *   nizmo-agent probe <address> [port] [password]   read a terminal, send nothing
 *   nizmo-agent enrol <code>                        connect this PC to the company
 *   nizmo-agent check                               one round, then stop
 *   nizmo-agent run                                 keep going (what the service runs)
 *
 * Its files live in NIZMO_AGENT_HOME, or beside the program: agent.json
 * (set up by hand), state.json (written by the agent; holds its token) and
 * logs/agent.log.
 */

const HELP = `Nizmo attendance agent ${AGENT_VERSION}

  nizmo-agent probe <address> [port] [password]
      Reads one terminal and shows what it is and how many scans it holds. Sends nothing.
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

export async function main(argv: string[]): Promise<number> {
    const [command, ...args] = argv
    const dir = home()
    const paths = { config: join(dir, "agent.json"), state: join(dir, "state.json"), log: join(dir, "logs", "agent.log") }

    if (!command || command === "help" || command === "--help") { process.stdout.write(HELP); return 0 }
    if (command === "version" || command === "--version") { process.stdout.write(`${AGENT_VERSION}\n`); return 0 }

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
    const state = loadState(paths.state)

    if (command === "enrol" || command === "enroll") {
        const [code] = args
        if (!code) { log.error("Give the code shown in Company Settings → Attendance, such as: nizmo-agent enrol K7QD-2MXP"); return 2 }
        const enrolled = await new SyncAgent(config, state, paths.state, log).enrol(code)
        log.info(`Enrolled as "${enrolled.name}" for ${enrolled.company}. Start the service, or run: nizmo-agent run`)
        return 0
    }

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

    process.stderr.write(HELP)
    return 2
}

// Run when started as a program, not when imported by a test.
if (typeof require !== "undefined" && require.main === module) {
    main(process.argv.slice(2)).then(code => process.exit(code), e => {
        process.stderr.write(`${(e as Error).message}\n`)
        process.exit(1)
    })
}
