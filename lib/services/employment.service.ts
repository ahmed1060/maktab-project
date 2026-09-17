import { prisma } from "@/lib/prisma"
import type { Prisma, UserStatus } from "@prisma/client"
import {
    timelineForMonth,
    eventForStatusChange,
    impliedStatusAt,
    reconcileStatus,
    previewSettlement,
    type EmploymentEventRow,
    type EmploymentEventType,
    type MonthTimeline,
    type SettlementPreview,
} from "@/lib/employment"
import { SalaryHistoryService } from "./salary-history.service"
import { calendarParts } from "@/lib/time"

/**
 * The one writer for what happened to somebody's employment.
 *
 * Same shape as SalaryHistoryService, and for the same reason. User.status is
 * what every screen and every gate reads; EmploymentEvent is what happened.
 * They move together or not at all — a person whose contract ended in the
 * timeline but who can still sign in is worse than either fact alone, because
 * each half is individually true and nobody can tell which one is stale.
 *
 * And, as with salary, the status only moves when the event is already in
 * force. A contract ending on the 1st of next month, recorded today, must not
 * lock somebody out for the rest of this one.
 */

/** What User.status reads once an event takes effect. */
const STATUS_AFTER: Record<EmploymentEventType, UserStatus> = {
    HIRED: "ACTIVE",
    SUSPENDED: "SUSPENDED",
    UNSUSPENDED: "ACTIVE",
    CONTRACT_ENDED: "ARCHIVED",
    REINSTATED: "ACTIVE",
}

export class EmploymentService {
    /**
     * Record an employment event.
     *
     * `effectiveFrom` is the instant it takes effect, which for CONTRACT_ENDED
     * is the *first* instant they are no longer employed — the day before is
     * their last working day. Any date is allowed, past or future: a suspension
     * entered three days late has to be dated when it started, or the days in
     * between are paid as though nothing happened.
     */
    static async record(
        input: {
            userId: string
            type: EmploymentEventType
            effectiveFrom: Date
            reason?: string
            /** UNSUSPENDED only. */
            deductSuspension?: boolean | null
            createdById?: string | null
        },
        tx?: Prisma.TransactionClient,
    ) {
        if (input.deductSuspension != null && input.type !== "UNSUSPENDED") {
            // The decision belongs to the event that ends a suspension. Letting
            // it ride on any other type would put two answers in the timeline
            // with no rule for which one counts.
            throw new Error(`deductSuspension is only meaningful on UNSUSPENDED, not ${input.type}`)
        }

        const run = async (client: Prisma.TransactionClient) => {
            const event = await client.employmentEvent.create({
                data: {
                    userId: input.userId,
                    type: input.type,
                    effectiveFrom: input.effectiveFrom,
                    reason: input.reason ?? null,
                    deductSuspension: input.deductSuspension ?? null,
                    createdById: input.createdById ?? null,
                },
            })

            if (input.effectiveFrom.getTime() <= Date.now()) {
                await client.user.update({
                    where: { id: input.userId },
                    data: { status: STATUS_AFTER[input.type] },
                })
            }

            return event
        }

        return tx ? run(tx) : prisma.$transaction(run)
    }

    /**
     * Record whatever employment event a status change amounts to.
     *
     * The bridge for the screens that already existed. A suspend toggle writes
     * User.status; without this it would leave no trace in the timeline, and a
     * payslip would pay a suspended month in full because nothing said
     * otherwise. Returns null when the transition is not about employment —
     * ACTIVE to OFFLINE is presence, not a change of contract.
     *
     * The status itself has already been written by the caller, so this only
     * adds the event: passing it back through record() would write the status a
     * second time, and on a future-dated event would write the wrong one.
     */
    static async recordStatusChange(
        input: {
            userId: string
            previousStatus: string | null | undefined
            newStatus: string
            reason?: string
            createdById?: string | null
        },
        tx?: Prisma.TransactionClient,
    ) {
        const type = eventForStatusChange(input.previousStatus, input.newStatus)
        if (!type) return null

        const client = tx ?? prisma
        return client.employmentEvent.create({
            data: {
                userId: input.userId,
                type,
                effectiveFrom: new Date(),
                reason: input.reason ?? null,
                // Undecided on purpose. A toggle back to active says the
                // suspension is over; it does not say whether it cost anybody
                // pay, and inventing "no" here would settle a question nobody
                // asked.
                deductSuspension: null,
                createdById: input.createdById ?? null,
            },
        })
    }

    /** Everything on record for a person, oldest first. */
    static async history(userId: string): Promise<EmploymentEventRow[]> {
        const events = await prisma.employmentEvent.findMany({
            where: { userId },
            orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
        })
        return events.map(e => ({
            type: e.type as EmploymentEventType,
            effectiveFrom: e.effectiveFrom,
            reason: e.reason,
            deductSuspension: e.deductSuspension,
            createdAt: e.createdAt,
        }))
    }

    /** Which days of a month somebody was employed, and which were suspended. */
    static async timelineForMonth(
        userId: string,
        year: number,
        month: number,
        timeZone?: string,
    ): Promise<MonthTimeline> {
        return timelineForMonth(await this.history(userId), year, month, timeZone)
    }

    /**
     * Bring User.status in line with the timeline for every event whose date
     * has arrived.
     *
     * This is what makes a future-dated event mean anything. record() only
     * moves the status when the event is already in force, which is right — a
     * contract ending on the 1st of next month must not lock somebody out
     * today — but it leaves the change waiting for something to apply it, and
     * without this job that something never comes. The person would keep
     * working, keep logging in, and keep being paid, with a timeline that has
     * said since last month that they left.
     *
     * Only the accounts the timeline has an opinion about are read: a
     * suspension, an unsuspension, a contract end or a reinstatement somewhere
     * in their history. The backfilled population — one HIRED row at the epoch
     * and nothing since — is skipped, because there is nothing there that could
     * disagree with anything.
     */
    static async applyDueEvents(now: Date = new Date()) {
        const candidates = await prisma.user.findMany({
            where: {
                EmploymentEvent: {
                    some: { type: { in: ["SUSPENDED", "UNSUSPENDED", "CONTRACT_ENDED", "REINSTATED"] } },
                },
            },
            select: {
                id: true,
                status: true,
                EmploymentEvent: {
                    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
                    select: { type: true, effectiveFrom: true, createdAt: true, deductSuspension: true, reason: true },
                },
            },
        })

        const applied: { userId: string; from: string; to: string }[] = []

        for (const user of candidates) {
            const events: EmploymentEventRow[] = user.EmploymentEvent.map(e => ({
                type: e.type as EmploymentEventType,
                effectiveFrom: e.effectiveFrom,
                reason: e.reason,
                deductSuspension: e.deductSuspension,
                createdAt: e.createdAt,
            }))

            const next = reconcileStatus(user.status, impliedStatusAt(events, now))
            if (!next) continue

            await prisma.user.update({ where: { id: user.id }, data: { status: next } })
            applied.push({ userId: user.id, from: user.status, to: next })
        }

        return { checked: candidates.length, applied }
    }

    /**
     * What ending a contract on a given date would settle at, without ending it.
     *
     * The preview is the point: the sign flips on whether the month's salary
     * had already gone out, so an admin picking a date needs to see which way
     * it falls before they commit, not after.
     *
     * `paidMinor` comes from the caller because what has been paid lives in the
     * payroll tables, which arrive with the payroll schema. Until then it is
     * zero, which reads as "payday has not come round" — the preview is honest
     * about being computed from what it was given.
     */
    static async previewSettlement(input: {
        userId: string
        endsAt: Date
        paidMinor?: number
        timeZone?: string
    }): Promise<SettlementPreview> {
        const { year, month } = calendarParts(input.endsAt, input.timeZone)
        const [events, rates] = await Promise.all([
            this.history(input.userId),
            SalaryHistoryService.ratesForMonth(input.userId, year, month, input.timeZone),
        ])

        return previewSettlement({
            events,
            rates,
            endsAt: input.endsAt,
            paidMinor: input.paidMinor,
            timeZone: input.timeZone,
        })
    }
}
