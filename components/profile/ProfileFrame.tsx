'use client'
import type { ReactNode } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useModules } from '@/lib/useModules'
import { Card, PageHeader, SectionLink } from '@/components/ui'

/**
 * A person's profile, on the building blocks in parts (UI_PLAN.md §5 step 5,
 * the pages left). Part 1, PR 191: its page header, its photo
 * (./ProfilePhoto.tsx), and a name change waiting. It was a glass card of
 * its own making, with a title of its own.
 */

/**
 * Someone else's profile is under their name, saying what the page is, and
 * goes back to Employees, as their history does; until the name has come,
 * what the page is is its title. One's own, opened from the account menu,
 * is My profile, with nowhere to go back to. Seen, its action is Edit (part
 * 2, PR 192).
 */
export function ProfileHeader({ own, editing, name, action }: { own: boolean; editing: boolean; name: string | null; action?: ReactNode }) {
    const { t } = useLanguage()
    const modules = useModules()
    if (own) return <PageHeader title={t('my_profile')} action={action} />
    const what = t(editing ? 'edit_employee_title' : 'employee_profile')
    return (
        <PageHeader
            back={{ href: '/dashboard/employees', label: modules.label('employees') }}
            title={name ? <bdi>{name}</bdi> : what}
            subtitle={name ? what : undefined}
            action={action}
        />
    )
}

/**
 * One's own name change, while it waits for whoever decides it: the name
 * asked for, which keeps its own direction, and the request on the
 * Requests page, under Mine. Just asked for, it has no id yet, and opens
 * the kind's list.
 */
export function NameChangeWaiting({ name, requestId }: { name: string; requestId?: string }) {
    const { t } = useLanguage()
    const [before, after] = t('name_change_waiting_body').split('{name}')
    const href = `/dashboard/requests?kind=nameChange${requestId ? `&highlight=${encodeURIComponent(requestId)}` : ''}`
    return (
        <Card tone="waiting" title={t('name_change_waiting_title')} actions={<SectionLink href={href}>{t('name_change_waiting_open')}</SectionLink>}>
            <p>{before}<bdi>{name}</bdi>{after}</p>
        </Card>
    )
}
