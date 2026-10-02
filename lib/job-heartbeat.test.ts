import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { SCHEDULED_JOBS, isOverdue } from "./services/job-heartbeat.service"
import { stripComments } from "./strip-comments"

/**
 * The heartbeat exists because all six scheduled jobs recorded only their
 * failures: each calls AuditLogService.logSystemError from its catch block and
 * wrote nothing at all on success. So "when did salary-init last work?" had no
 * answer, and — worse — a job that stopped firing left no trace whatsoever. An
 * error writes a row; silence writes nothing. That is how the yearly leave
 * reset has gone its whole life without running unnoticed.
 *
 * All of which only holds while the register matches reality. A job added to
 * vercel.json and not to SCHEDULED_JOBS is invisible to the card in exactly
 * the way everything was before, and nothing else would ever say so.
 */
const VERCEL = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] }
/** Jobs fired from outside Vercel, more often than its Hobby plan allows (job-heartbeat.service.ts). */
const EXTERNAL = SCHEDULED_JOBS.filter(j => "firedBy" in j && j.firedBy === "external").map(j => j.job as string)

describe("the register matches what is actually scheduled", () => {
    it("has an entry for every cron in vercel.json", () => {
        const scheduled = VERCEL.crons.map(c => c.path.split("/").filter(Boolean).pop()!)
        const registered = SCHEDULED_JOBS.map(j => j.job)

        for (const job of scheduled) {
            expect(registered, `${job} is scheduled but not in SCHEDULED_JOBS, so the card cannot miss it`)
                .toContain(job)
        }
    })

    it("does not watch for jobs that are not scheduled", () => {
        // A registered job that nothing fires is permanently overdue, and a
        // card that is always red is a card nobody reads.
        const scheduled = [...VERCEL.crons.map(c => c.path.split("/").filter(Boolean).pop()!), ...EXTERNAL]
        for (const { job } of SCHEDULED_JOBS) {
            expect(scheduled, `${job} is registered but nothing in vercel.json fires it`).toContain(job)
        }
    })

    it("records a heartbeat from every one of those routes", () => {
        // Wiring the register without wiring the route gives a job that is
        // running fine and reports as dead.
        for (const { job } of SCHEDULED_JOBS) {
            const path = VERCEL.crons.find(c => c.path.endsWith(`/${job}`))?.path ?? `/api/cron/${job}`
            const source = stripComments(readFileSync(`app${path}/route.ts`, "utf8"))
            expect(source, `${path} does not record a heartbeat`).toContain(`JobHeartbeatService.run("${job}"`)
        }
    })
})

describe("a job fired from outside", () => {
    it("has its route, answering GET, and isn't also in vercel.json", () => {
        // Fired by an outside scheduler with CRON_SECRET, as Vercel would.
        for (const job of EXTERNAL) {
            const source = readFileSync(`app/api/cron/${job}/route.ts`, "utf8")
            expect(source).toMatch(/export (async function|const) GET/)
            expect(stripComments(source)).toContain("isValidCronRequest(req)")
            expect(VERCEL.crons.map(c => c.path)).not.toContain(`/api/cron/${job}`)
        }
        expect(EXTERNAL).toContain("check-in-reminder")
    })
})

describe("overdue tracks the job's own interval", () => {
    const now = new Date("2026-09-17T12:00:00Z")
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 36e5)

    it("treats a job that has never run as overdue", () => {
        // The loudest thing this can report, and the one a table of past runs
        // could never say at all.
        expect(isOverdue(24, null, now)).toBe(true)
    })

    it("allows a daily job to drift", () => {
        // Vercel's cron window is about an hour wide, so a daily job that ran
        // 25 hours ago is on time. Crying wolf nightly is how a card stops
        // being read.
        expect(isOverdue(24, hoursAgo(25), now)).toBe(false)
        expect(isOverdue(24, hoursAgo(40), now)).toBe(true)
    })

    it("does not call a monthly job late after a day", () => {
        // The mistake a single global threshold would make: 40 hours is
        // alarming for a nightly job and unremarkable for salary-init.
        const monthly = SCHEDULED_JOBS.find(j => j.job === "salary-init")!.everyHours
        expect(isOverdue(monthly, hoursAgo(40), now)).toBe(false)
        expect(isOverdue(monthly, hoursAgo(24 * 60), now)).toBe(true)
    })

    it("gives the yearly reset a year", () => {
        const yearly = SCHEDULED_JOBS.find(j => j.job === "reset-day-off")!.everyHours
        expect(isOverdue(yearly, hoursAgo(24 * 300), now)).toBe(false)
    })
})

describe("the heartbeat cannot break the job it watches", () => {
    it("records outside the caller's control flow and swallows its own errors", () => {
        // A heartbeat that threw would turn a working job into a failed one on
        // a bad day for the database — strictly worse than not having it.
        const source = stripComments(readFileSync("lib/services/job-heartbeat.service.ts", "utf8"))
        expect(source, "record() no longer catches its own failures").toMatch(
            /catch \(heartbeatError\)[\s\S]*console\.error/,
        )
        // And the original error still reaches the route, so the audit log and
        // the HTTP response are unchanged by any of this.
        expect(source).toContain("throw error")
    })
})
