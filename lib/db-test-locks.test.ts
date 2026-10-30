import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"

/**
 * A database test that waits until one transaction is held up by another
 * looks for it in pg_locks. pg_locks is the whole server's: the other .db
 * tests run beside it, each in a database of its own, and one of theirs
 * waiting ended the wait early, so the test let go before what it tests had
 * started to wait. Found when "ends nothing when the advance changed" failed
 * in a full run and passed on its own. Each counts only who waits in its own
 * database, by the connection's database: a row's lock has none of its own.
 */
describe("a database test waiting on a lock", () => {
    const files = readdirSync("lib").filter(f => f.endsWith(".db.test.ts")).map(f => `lib/${f}`)

    it("looks only at its own database", () => {
        const unscoped = files.flatMap(f => readFileSync(f, "utf8").split("\n")
            .filter(line => line.includes("FROM pg_locks") && !line.includes("a.datname = current_database()"))
            .map(line => `${f}: ${line.trim()}`))
        expect(unscoped).toEqual([])
    })
})
