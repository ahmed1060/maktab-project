import { resolveSubscriptionState, type SubscriptionFacts } from "./state"
import type { NoticeText } from "@/lib/notice"
import { englishNotice } from "@/lib/notice-row"

/**
 * Which lifecycle notices a company is due, given its state and what has
 * already been sent.
 *
 * A pure decision, like the reminder ladder: the job that calls this only
 * gathers recipients and writes. Two of these are emails through a single
 * unqueued Gmail account, so "have we already sent this" is not a nicety.
 */

export const LIFECYCLE_NOTICES = [
    'TRIAL_ENDING_24H',
    'GRACE_STARTED',
    'GRACE_ENDING_24H',
    'LOCKED',
] as const

export type LifecycleNotice = (typeof LIFECYCLE_NOTICES)[number]

/** Who a notice is addressed to, per the decision that email is for the customer and the bell for the operator. */
export const NOTICE_AUDIENCE: Record<LifecycleNotice, 'customer' | 'operator'> = {
    // The customer cannot be assumed to be watching the app, and these two are
    // the ones where the consequence is losing access.
    GRACE_STARTED: 'customer',
    LOCKED: 'customer',
    // You are in this system daily, so the bell reaches you as reliably as an
    // inbox and costs nothing now that Super Admins can receive notifications.
    TRIAL_ENDING_24H: 'operator',
    GRACE_ENDING_24H: 'operator',
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export function decideLifecycleNotices(
    facts: SubscriptionFacts,
    alreadySent: readonly string[],
    now: Date = new Date()
): LifecycleNotice[] {
    const sent = new Set(alreadySent)
    const { state, date } = resolveSubscriptionState(facts, now)
    const due: LifecycleNotice[] = []

    const msUntil = date ? date.getTime() - now.getTime() : null

    if (state === 'TRIAL' && msUntil !== null && msUntil <= ONE_DAY_MS) {
        due.push('TRIAL_ENDING_24H')
    }

    if (state === 'GRACE') {
        // Grace began the moment the period ended, so a company found in grace
        // is owed the notice whether or not the job ran on the exact day —
        // unlike the reminder ladder, where an early rung's moment genuinely
        // passes. Missing this one means the customer's first warning is the
        // account stopping.
        due.push('GRACE_STARTED')
        if (msUntil !== null && msUntil <= ONE_DAY_MS) due.push('GRACE_ENDING_24H')
    }

    if (state === 'LOCKED') {
        // A company that expired while the job was not running never got its
        // grace notice. Send it alongside the lockout rather than swallowing
        // it: "your subscription expired" followed by "you are now locked" is a
        // coherent pair, and silence is not.
        due.push('GRACE_STARTED')
        due.push('LOCKED')
    }

    return due.filter(notice => !sent.has(notice))
}

/**
 * The two customer-facing emails.
 *
 * Plain, short, and explicit that nothing has been deleted. A customer who
 * believes their records are gone does not renew — they write the account off
 * and start somewhere else.
 */
export function lifecycleEmailCopy(notice: LifecycleNotice, companyName: string): { subject: string; body: string } {
    if (notice === 'GRACE_STARTED') {
        return {
            subject: `Your Nizmo subscription has expired — ${companyName}`,
            body: [
                `Your subscription for ${companyName} has ended.`,
                ``,
                `Everything still works for now, but access will pause shortly unless the subscription is renewed. Please contact your account manager to renew.`,
                ``,
                `Nothing has been deleted. Every task, record and document is exactly where you left it, and renewing restores full access immediately.`,
            ].join('\n'),
        }
    }

    return {
        subject: `Nizmo access paused — ${companyName}`,
        body: [
            `Access to Nizmo for ${companyName} is now paused because the subscription was not renewed.`,
            ``,
            `Administrators can still sign in. Everyone else will see a message asking them to contact an administrator.`,
            ``,
            `Nothing has been deleted. Every task, record and document is exactly where you left it, and renewing restores access for the whole team immediately.`,
        ].join('\n'),
    }
}

/** The in-app wording for the operator, who needs the company named (lib/notice.ts). */
export function lifecycleOperatorNotice(notice: LifecycleNotice, companyName: string): NoticeText {
    const params = { company: companyName }
    switch (notice) {
        case 'TRIAL_ENDING_24H': return { key: 'notice_trial_ending', params }
        case 'GRACE_ENDING_24H': return { key: 'notice_grace_ending', params }
        case 'LOCKED': return { key: 'notice_company_locked', params }
        case 'GRACE_STARTED': return { key: 'notice_grace_started', params }
    }
}

/** Its English. */
export function lifecycleOperatorMessage(notice: LifecycleNotice, companyName: string): string {
    return englishNotice(lifecycleOperatorNotice(notice, companyName))
}
