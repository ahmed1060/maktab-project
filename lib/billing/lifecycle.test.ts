import { describe, it, expect } from "vitest"
import { decideLifecycleNotices, LIFECYCLE_NOTICES, NOTICE_AUDIENCE, lifecycleEmailCopy, lifecycleOperatorMessage } from "./lifecycle"
import { isBlockedBySubscription, subscriptionNotice, resolveSubscriptionState, type SubscriptionFacts } from "./state"

const resolveState = (f: SubscriptionFacts, now: Date) => resolveSubscriptionState(f, now).state

const d = (s: string) => new Date(s + "T12:00:00.000Z")
const NOW = d("2026-09-13")
const facts = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({ createdAt: d("2026-01-01"), ...over })

describe("who a lockout actually stops", () => {
    it("blocks employees and team leaders when LOCKED", () => {
        expect(isBlockedBySubscription('LOCKED', 'EMPLOYEE')).toBe(true)
        expect(isBlockedBySubscription('LOCKED', 'TEAM_LEADER')).toBe(true)
    })

    it("never blocks the company's own Admin", () => {
        // They are the person who has to see what is wrong and renew it.
        // Locking them out leaves the account with nobody able to fix it.
        expect(isBlockedBySubscription('LOCKED', 'ADMIN')).toBe(false)
    })

    it("never blocks a Super Admin", () => {
        expect(isBlockedBySubscription('LOCKED', 'SUPER_ADMIN')).toBe(false)
    })

    it("blocks nobody in any other state", () => {
        for (const state of ['TRIAL', 'ACTIVE', 'GRACE', 'LIFETIME'] as const) {
            for (const role of ['EMPLOYEE', 'TEAM_LEADER', 'ADMIN', 'SUPER_ADMIN']) {
                expect(isBlockedBySubscription(state, role), `${state}/${role}`).toBe(false)
            }
        }
    })

    it("grace keeps everyone working — that is what grace is for", () => {
        expect(isBlockedBySubscription('GRACE', 'EMPLOYEE')).toBe(false)
        expect(subscriptionNotice('GRACE')).toBe('warning')
    })

    it("a trial restricts nothing and shows a neutral notice", () => {
        expect(isBlockedBySubscription('TRIAL', 'EMPLOYEE')).toBe(false)
        expect(subscriptionNotice('TRIAL')).toBe('info')
    })

    it("an unknown role is blocked rather than waved through", () => {
        // The allow-list is Admin and Super Admin; anything else is an
        // ordinary user, including a role added later that nobody revisited.
        expect(isBlockedBySubscription('LOCKED', undefined)).toBe(true)
        expect(isBlockedBySubscription('LOCKED', 'FUTURE_ROLE')).toBe(true)
    })
})

describe("which notices are due", () => {
    it("says nothing while a subscription is simply working", () => {
        expect(decideLifecycleNotices(facts({ latestPaidPeriod: { endDate: d("2027-01-01") } }), [], NOW)).toEqual([])
        expect(decideLifecycleNotices(facts({ latestPaidPeriod: { endDate: null } }), [], NOW)).toEqual([])
    })

    it("warns the day before a trial runs out, not earlier", () => {
        const endingTomorrow = facts({ createdAt: d("2026-09-07"), trialPreset: "SEVEN_DAYS" })
        expect(decideLifecycleNotices(endingTomorrow, [], NOW)).toContain('TRIAL_ENDING_24H')

        const endingLater = facts({ createdAt: d("2026-09-10"), trialPreset: "FOURTEEN_DAYS" })
        expect(decideLifecycleNotices(endingLater, [], NOW)).toEqual([])
    })

    it("announces grace the moment a period has ended", () => {
        const inGrace = facts({ latestPaidPeriod: { endDate: d("2026-09-12") } })
        expect(decideLifecycleNotices(inGrace, [], NOW)).toContain('GRACE_STARTED')
    })

    it("adds the 24-hour warning as grace runs out", () => {
        const nearlyOver = facts({ latestPaidPeriod: { endDate: d("2026-09-11") } })
        const due = decideLifecycleNotices(nearlyOver, ['GRACE_STARTED'], NOW)
        expect(due).toEqual(['GRACE_ENDING_24H'])
    })

    it("sends the grace notice alongside the lockout if the job missed it", () => {
        // A company that expired while the job was not running never got its
        // warning. "Expired, then locked" is a coherent pair; silence is not.
        const locked = facts({ latestPaidPeriod: { endDate: d("2026-08-01") } })
        const due = decideLifecycleNotices(locked, [], NOW)
        expect(due).toEqual(['GRACE_STARTED', 'LOCKED'])
    })

    it("does not repeat the grace notice once it has been sent", () => {
        const locked = facts({ latestPaidPeriod: { endDate: d("2026-08-01") } })
        expect(decideLifecycleNotices(locked, ['GRACE_STARTED'], NOW)).toEqual(['LOCKED'])
        expect(decideLifecycleNotices(locked, ['GRACE_STARTED', 'LOCKED'], NOW)).toEqual([])
    })

    it("never repeats anything already sent, in any state", () => {
        const everyState: SubscriptionFacts[] = [
            facts({ createdAt: d("2026-09-07"), trialPreset: "SEVEN_DAYS" }),
            facts({ latestPaidPeriod: { endDate: d("2026-09-12") } }),
            facts({ latestPaidPeriod: { endDate: d("2026-09-11") } }),
            facts({ latestPaidPeriod: { endDate: d("2026-08-01") } }),
        ]
        for (const f of everyState) {
            expect(decideLifecycleNotices(f, [...LIFECYCLE_NOTICES], NOW)).toEqual([])
        }
    })

    it("a lifetime subscription is never due anything", () => {
        expect(decideLifecycleNotices(facts({ latestPaidPeriod: { endDate: null } }), [], d("2126-01-01"))).toEqual([])
    })

    it("a grandfathered company is never due anything", () => {
        expect(decideLifecycleNotices(facts({}), [], NOW)).toEqual([])
    })
})

describe("who each notice is addressed to", () => {
    it("email for the customer, bell for the operator", () => {
        expect(NOTICE_AUDIENCE.GRACE_STARTED).toBe('customer')
        expect(NOTICE_AUDIENCE.LOCKED).toBe('customer')
        expect(NOTICE_AUDIENCE.TRIAL_ENDING_24H).toBe('operator')
        expect(NOTICE_AUDIENCE.GRACE_ENDING_24H).toBe('operator')
    })

    it("every notice has an audience, so none can be silently dropped", () => {
        for (const notice of LIFECYCLE_NOTICES) {
            expect(NOTICE_AUDIENCE[notice], notice).toBeDefined()
        }
    })
})

describe("the customer-facing copy", () => {
    for (const notice of ['GRACE_STARTED', 'LOCKED'] as const) {
        it(`${notice} names the company and says nothing was deleted`, () => {
            // A customer who believes their records are gone does not renew —
            // they write the account off and start somewhere else.
            const { subject, body } = lifecycleEmailCopy(notice, 'Cura Tech')
            expect(subject).toContain('Cura Tech')
            expect(body).toContain('Cura Tech')
            expect(body).toMatch(/[Nn]othing has been deleted/)
            expect(body).toMatch(/renew/i)
        })
    }

    it("the operator wording names the company for every notice", () => {
        for (const notice of LIFECYCLE_NOTICES) {
            expect(lifecycleOperatorMessage(notice, 'Cura Tech'), notice).toContain('Cura Tech')
        }
    })
})

describe("what this deploy does to the live companies", () => {
    // Production at the time of writing. All four are ACTIVE with future end
    // dates, so C2 locks nobody out on the day it ships — but one of them has a
    // date, and it is worth knowing rather than discovering.
    const live = [
        { name: "Software Testing", end: "2026-10-08T08:57:51Z", users: 4, admins: 1 },
        { name: "CuraTech", end: "2027-09-08T08:57:08Z", users: 0, admins: 0 },
        { name: "QA Sandbox", end: "2027-09-08T08:58:04Z", users: 4, admins: 1 },
        { name: "CuraTech Demo", end: "2027-09-08T16:21:31Z", users: 5, admins: 1 },
    ]
    const DEPLOY_DAY = new Date("2026-09-13T13:00:00.000Z")

    it("locks nobody, and owes nobody a notice, on deploy day", () => {
        for (const company of live) {
            const f = facts({ latestPaidPeriod: { endDate: new Date(company.end) } })
            expect(resolveState(f, DEPLOY_DAY), company.name).toBe("ACTIVE")
            expect(decideLifecycleNotices(f, [], DEPLOY_DAY), company.name).toEqual([])
        }
    })

    it("Software Testing keeps working through all of 8 October, Cairo time", () => {
        // Its stored endDate is 08:57 UTC. Under a raw comparison it would have
        // expired mid-morning on the last day its customer had paid for.
        const f = facts({ latestPaidPeriod: { endDate: new Date("2026-10-08T08:57:51Z") } })
        expect(resolveState(f, new Date("2026-10-08T18:00:00Z"))).toBe("ACTIVE")
        expect(resolveState(f, new Date("2026-10-08T20:00:00Z"))).toBe("ACTIVE")
    })

    it("...enters grace once that Cairo day ends, and locks 48 hours later", () => {
        const f = facts({ latestPaidPeriod: { endDate: new Date("2026-10-08T08:57:51Z") } })
        // 21:00Z on the 8th is already the 9th in Cairo (UTC+3 in summer).
        expect(resolveState(f, new Date("2026-10-08T21:30:00Z"))).toBe("GRACE")
        expect(resolveState(f, new Date("2026-10-10T20:00:00Z"))).toBe("GRACE")
        expect(resolveState(f, new Date("2026-10-10T21:30:00Z"))).toBe("LOCKED")
    })

    it("and then stops its three non-admin users, but not its Admin", () => {
        // 4 active users, 1 of them an Admin. The Admin still signs in and lands
        // on the expired page; the other three are stopped at login.
        expect(isBlockedBySubscription('LOCKED', 'ADMIN')).toBe(false)
        expect(isBlockedBySubscription('LOCKED', 'EMPLOYEE')).toBe(true)
    })
})
