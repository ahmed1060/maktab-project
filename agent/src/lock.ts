import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs"

/**
 * One agent process at a time per folder. The service (`run`), and
 * `enrol` and `check` typed by hand, each hold agent.lock while they work:
 * otherwise an enrolment while the service runs leaves two copies of the
 * state, and the service writes its old token over the new one (review on
 * #18). A lock whose process has gone is taken over.
 */

export class LockedError extends Error {
    constructor(readonly pid: number) {
        super(`Another nizmo-agent (process ${pid}) is using this folder.`)
    }
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (e) {
        // Exists, but belongs to someone else.
        return (e as NodeJS.ErrnoException).code === "EPERM"
    }
}

export function acquireLock(path: string): { release(): void } {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = openSync(path, "wx")
            writeSync(fd, String(process.pid))
            closeSync(fd)
            let released = false
            const release = () => {
                if (released) return
                released = true
                try { unlinkSync(path) } catch { /* already gone */ }
            }
            process.once("exit", release)
            return { release }
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
            const pid = Number(readFileSync(path, "utf8").trim())
            if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid)) throw new LockedError(pid)
            // Left by a process that has gone: take it over.
            try { unlinkSync(path) } catch { /* someone else did */ }
        }
    }
    throw new Error(`Could not take ${path}.`)
}
