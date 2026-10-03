import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs"
import { dirname } from "node:path"
import type { Logger } from "./sync"

/**
 * A log file beside the agent, for whoever looks after the office PC:
 * plain lines with the time, kept to two files of 5 MB at most.
 */

const MAX_BYTES = 5 * 1024 * 1024

export function fileLogger(path: string, echo = true): Logger {
    mkdirSync(dirname(path), { recursive: true })
    const write = (level: string, message: string) => {
        const line = `${new Date().toISOString()} ${level.padEnd(5)} ${message}\n`
        if (echo) (level === "ERROR" ? process.stderr : process.stdout).write(line)
        try {
            if (existsSync(path) && statSync(path).size > MAX_BYTES) renameSync(path, `${path}.1`)
            appendFileSync(path, line)
        } catch { /* a full disk must not stop the agent */ }
    }
    return { info: m => write("INFO", m), warn: m => write("WARN", m), error: m => write("ERROR", m) }
}
