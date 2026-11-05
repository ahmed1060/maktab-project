"use client"

import { CheckCircleIcon } from "@phosphor-icons/react/ssr"
import { Card, Icon, Page, PageHeader } from "@/components/ui"
import { useLanguage } from "@/context/LanguageContext"
import { DEFAULT_TIME_ZONE } from "@/lib/time"

/**
 * The page a locked company's people are held on (DESIGN.md §5.5), where
 * its Admin, the one who can still sign in, renews it. Deliberately not an
 * error page: the account is intact, nothing has been deleted, and saying
 * so is the difference between a customer who renews and one who assumes
 * their data is gone.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the pages left): a glass
 * card under an hourglass emoji, the day it locked in red, on the reader's
 * own calendar, so a day out from the server's on a phone abroad.
 */
export default function SubscriptionExpired({ lockedOn }: { lockedOn: string | null }) {
    const { t, locale } = useLanguage()

    // On Egypt's calendar, as subscriptions are counted (lib/billing/state.ts):
    // the same day on the server and in the browser, wherever it is.
    const day = lockedOn
        ? new Date(lockedOn).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", {
            day: "numeric", month: "short", year: "numeric", timeZone: DEFAULT_TIME_ZONE,
        })
        : null
    const when = [day && t("subscription_expired_paused").replace("{date}", day), t("subscription_expired_renew")]

    return (
        <Page>
            <PageHeader title={t("subscription_expired_title")} subtitle={when.filter(Boolean).join(" ")} />
            {/* The sentence that matters most on this page. A customer who
                believes their records are gone does not renew. */}
            <Card>
                <p className="ui-good-line">
                    <Icon icon={CheckCircleIcon} size={20} />
                    <span>{t("subscription_expired_data_safe")}</span>
                </p>
            </Card>
        </Page>
    )
}
