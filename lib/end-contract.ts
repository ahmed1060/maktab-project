import type { TranslationKey } from '@/lib/translations'

/**
 * Ending someone's contract from their details, and handing over a leader's
 * team (a person's profile, part 5, PR 195): what's worked out and checked
 * before anything is sent, and what the server's refusals say, in the
 * reader's language.
 */

/** What ending on a date would settle at, as the employment route previews it. */
export type Settlement = {
    daysWorked: number
    earned: number
    paid: number
    net: number
    direction: 'COMPANY_OWES' | 'PERSON_OWES' | 'SETTLED'
    paidSource: 'PAYSLIP' | 'RUN_NOT_PAID' | 'NO_RUN'
    debtsOutstanding: number
    debtRecovered: number
    /** What they still hold of a cash advance, which becomes a debt; in debtsOutstanding too. */
    cashAdvanceHeld?: number
    payable: number
}

/** This month's suspensions, as the route gives them with the preview. */
export type Timeline = { suspensions: { fromDay: number; toDay: number; deduct: boolean | null }[] }

/** The days of this month under a suspension nobody has ruled on. */
export function undecidedDays(timeline: Timeline | null | undefined): number {
    return (timeline?.suspensions ?? [])
        .filter(s => s.deduct === null)
        .reduce((days, s) => days + (s.toDay - s.fromDay + 1), 0)
}

/**
 * Whether ending on `lastWorkingDay` ends their access at once. Employment
 * ends at the start of the day after it, in the company's calendar
 * (endOfContractInstant), so a day before today has passed, and today's ends
 * tonight. `today` is the company's too.
 */
export function accessEndsNow(lastWorkingDay: string, today: string): boolean {
    return lastWorkingDay < today
}

/** The date, before anything is sent: one, typed in full. */
export function lastDayErrors({ lastWorkingDay, unreadable }: { lastWorkingDay: string; unreadable: boolean }): { lastWorkingDay?: TranslationKey } {
    // A date the browser couldn't read reads as empty.
    if (unreadable) return { lastWorkingDay: 'end_contract_date_incomplete' }
    if (!lastWorkingDay) return { lastWorkingDay: 'end_contract_date_needed' }
    return {}
}

/** Said under the date where it's about it, above the buttons otherwise. */
export type EndContractRefusal = { field?: 'lastWorkingDay'; key: TranslationKey }

const REFUSED: Record<string, EndContractRefusal> = {
    NOT_A_DATE: { field: 'lastWorkingDay', key: 'end_contract_date_incomplete' },
    NO_SALARY: { field: 'lastWorkingDay', key: 'end_contract_no_salary' },
    LAST_ADMIN: { key: 'end_contract_last_admin' },
    ADMIN_IS_SUPER_ADMINS: { key: 'end_contract_admin' },
    USER_HAS_NO_COMPANY: { key: 'end_contract_no_company' },
}

/**
 * What a refusal of the preview or of ending says, by its code. 'quiet' for
 * the code prompt of a high-risk action, turned down: the prompt said what it
 * needed. Null for one with no code known here, said as the server put it.
 */
export function endContractRefusal(body: { code?: unknown } | null | undefined): EndContractRefusal | 'quiet' | null {
    const code = body?.code
    if (code === 'STEP_UP_REQUIRED' || code === 'MFA_ENROL_REQUIRED') return 'quiet'
    return typeof code === 'string' && Object.hasOwn(REFUSED, code) ? REFUSED[code] : null
}

const LEADER_REFUSED: Record<string, TranslationKey> = {
    LEADER_UNAVAILABLE: 'handoff_leader_archived',
    TEAM_LEADER_NOT_FOUND: 'handoff_leader_gone',
    NOT_A_LEADER: 'handoff_leader_gone',
    DIFFERENT_COMPANY: 'handoff_leader_refused',
    REASSIGN_TARGET_IS_LEAVING: 'handoff_leader_refused',
    ONLY_EMPLOYEES_HAVE_LEADERS: 'handoff_leader_refused',
    SELF_LEADERSHIP: 'handoff_leader_refused',
}

/** Why the leader picked to take a team can't, by the code lib/team-handoff-response.ts answers with. */
export function handoffRefusal(body: { code?: unknown } | null | undefined): TranslationKey | null {
    const code = body?.code
    return typeof code === 'string' && Object.hasOwn(LEADER_REFUSED, code) ? LEADER_REFUSED[code] : null
}

/**
 * The leaders who could take a team: not the one who's going, and none whose
 * account is archived, which the server refuses (lib/team-assignment.ts). The
 * list leaves out the deleted already.
 */
export function handoffLeaders<T extends { id: string; status?: string | null }>(leaders: T[], leaderId: string): T[] {
    return leaders.filter(l => l.id !== leaderId && l.status !== 'ARCHIVED')
}

/** A day the profile keeps, "30 November 2026", as it is wherever the viewer is: a day, not a moment. */
export function dayLabel(day: string, locale: string): string {
    const date = new Date(`${day}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return day
    return date.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** Their team leaders, any of whom could take a team: every one, as pickers ask (app/api/users/route.ts). */
export const TEAM_LEADERS = '/api/users?role=TEAM_LEADER&limit=1000'
