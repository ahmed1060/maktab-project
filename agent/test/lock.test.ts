import { describe, it, expect, vi } from "vitest"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// What happens elsewhere just after this process reads the lock, as another agent process would do it.
const meanwhile = vi.hoisted(() => ({ next: null as null | (() => void) }))
vi.mock("node:fs", async importOriginal => {
    const fs = await importOriginal<typeof import("node:fs")>()
    const readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
        const read = fs.readFileSync(...args)
        const then = meanwhile.next
        meanwhile.next = null
        then?.()
        return read
    }) as typeof fs.readFileSync
    return { ...fs, readFileSync, default: { ...fs, readFileSync } }
})

const { acquireLock, LockedError } = await import("../src/lock")

/** One agent process per folder (agent/src/lock.ts). */
describe("the folder's lock", () => {
    // No process has this number.
    const GONE = 2_147_483_646

    it("is taken over from a process that has gone", () => {
        const path = join(mkdtempSync(join(tmpdir(), "agent-lock-")), "agent.lock")
        writeFileSync(path, String(GONE))
        const lock = acquireLock(path)
        expect(readFileSync(path, "utf8")).toBe(String(process.pid))
        lock.release()
    })

    it("isn't taken from another process that took it over first (review on #62)", () => {
        // Both saw the lock of a process that has gone: the service restarting while somebody enrols. The other
        // takes it over just after this one reads it. Deleting it then deleted a live lock, and both went on.
        const path = join(mkdtempSync(join(tmpdir(), "agent-lock-")), "agent.lock")
        writeFileSync(path, String(GONE))
        const other = process.ppid
        meanwhile.next = () => writeFileSync(path, String(other))
        expect(() => acquireLock(path)).toThrow(LockedError)
        expect(readFileSync(path, "utf8")).toBe(String(other))
    })
})
