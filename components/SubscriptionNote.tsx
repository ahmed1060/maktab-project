'use client'

import { PageNote } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useViewer } from '@/lib/useCan'
import { countOf } from '@/lib/plural'
import { DEFAULT_TIME_ZONE } from '@/lib/time'
import type { TranslationKey } from '@/lib/translations'

/**
 * A company's free trial, or its grace, as a note above every page (DESIGN.md
 * §5.5): the last day, on Egypt's calendar as subscriptions are counted, and
 * how many days there are to it. While the subscription is simply working
 * there's nothing to say, and a locked company's page says it.
 *
 * The days are the server's (lib/billing/summary.ts), and travel on the
 * session: a count the browser made would be one its clock could be wrong
 * about, and this one decides whether somebody thinks there's still time to
 * pay. Read from the account the layout passed until the session has loaded
 * (useViewer), so it's there from the page's first paint.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the pages left): it was a box
 * of its own making under an emoji that said "2 day(s) left", "2" in Arabic
 * among Arabic-Indic digits, and "0 day(s) left" all through a trial's last
 * day; grace told everyone to renew, which only an Admin can.
 *
 * For the company's Admins alone, as the owner asked (DESIGN.md §5.5;
 * FIRST_CHANGES_PLAN.md §3, PR 359): they act on it, renewing, and are the
 * ones billing/state.ts never locks out. Nobody else in the company sees it.
 */
export default function SubscriptionNote() {
    const { t, locale } = useLanguage()
    const viewer = useViewer()
    if (viewer?.role !== 'ADMIN') return null
    const subscription = viewer.subscription
    if (!subscription?.date || (subscription.state !== 'TRIAL' && subscription.state !== 'GRACE')) return null

    const grace = subscription.state === 'GRACE'
    const day = new Date(subscription.date).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: DEFAULT_TIME_ZONE,
    })
    // A session from before the days were counted on Egypt's calendar has
    // the hours' count, until the browser next fetches it (app/providers.tsx:
    // every five minutes).
    const days = Math.max(0, subscription.daysToLastDay ?? subscription.daysRemaining ?? 0)
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in'
    const what = t(`${grace ? 'note_grace' : 'note_trial'}_${when}` as TranslationKey)
        .replace('{date}', day)
        .replace('{days}', countOf(t, locale, days, 'days'))
    // Its Admin renews it, and is the one still let in once it locks (lib/billing/state.ts).
    return <PageNote tone={grace ? 'problem' : 'neutral'}>{grace ? `${what} ${t('note_grace_admin')}` : what}</PageNote>
}
