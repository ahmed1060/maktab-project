import { closeSync, mkdirSync, openSync, readFileSync, rmdirSync, statSync, unlinkSync, writeSync } from "node:fs"

/**
 * One agent process at a time per folder. The service (`run`), and
 * `enrol` and `check` typed by hand, each hold agent.lock while they work:
 * otherwise an enrolment while the service runs leaves two copies of the
 * state, and the service writes its old token over the new one (review on
 * #18). A lock whose process has gone is taken over.
 *
 * Taking one over is done by one process at a time, under agent.lock.takeover,
 * a folder (made or refused at once by the system). Under it the lock is read
 * again: two that both saw the dead process, the service restarting while
 * somebody enrols, would otherwise each delete it, the second the first's new
 * live lock, and both go on (review on #62).
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

/** How long a takeover may hold its folder before it is taken for one that died part way. */
const TAKEOVER_STALE_MS = 10_000
/** How long to keep trying: past the stale age, so a takeover that died part way is cleared, not given up on (review on #49). */
const TAKEOVER_WAIT_MS = TAKEOVER_STALE_MS + 5_000
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const pidIn = (path: string) => Number(readFileSync(path, "utf8").trim())
const isLive = (pid: number) => Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid)

/** Deletes the lock if it still names a process that has gone, as the only process doing so; false when it is busy. */
function takeOver(path: string): boolean {
    const mutex = `${path}.takeover`
    try {
        mkdirSync(mutex)
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
        // Left by a takeover that died part way: cleared, and tried again.
        try { if (Date.now() - statSync(mutex).mtimeMs > TAKEOVER_STALE_MS) rmdirSync(mutex) } catch { /* gone meanwhile */ }
        return false
    }
    try {
        let pid: number
        try { pid = pidIn(path) } catch { return true /* gone: free to create */ }
        if (isLive(pid)) throw new LockedError(pid)
        try { unlinkSync(path) } catch { /* gone */ }
        return true
    } finally {
        try { rmdirSync(mutex) } catch { /* gone */ }
    }
}

export function acquireLock(path: string): { release(): void } {
    const deadline = Date.now() + TAKEOVER_WAIT_MS
    while (Date.now() <= deadline) {
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
            let pid: number
            try { pid = pidIn(path) } catch { continue /* gone meanwhile: try again */ }
            if (isLive(pid)) throw new LockedError(pid)
            // Left by a process that has gone: take it over, or wait while another does.
            if (!takeOver(path)) pause(50)
        }
    }
    throw new Error(`Could not take ${path}.`)
}
