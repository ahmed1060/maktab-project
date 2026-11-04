'use client'
import { useLanguage } from '@/context/LanguageContext'
import { Button, Card, Details, StatusBadge } from '@/components/ui'
import { countOf } from '@/lib/plural'
import { STATUS_TONE, STATUS_WORD } from '@/lib/person-status'
import type { ProfileAccess } from '@/lib/profile-access'
import { PhotoRow } from './ProfilePhoto'

/**
 * Someone else's profile, seen (a person's profile, part 2, PR 192): their
 * photo, and their facts as details (DESIGN.md §5.5, Details), each only for
 * whoever may see it. What can be done to a fact, such as resetting their
 * password or ending their contract, is beside it; Edit is the page header's.
 * It was the form with every field turned off.
 */

export type ProfileFacts = {
    email: string
    username: string
    gender: string
    /** Their company's name, for the Super Admin's eye. */
    company: string | null
    /** Their role, as it's said (roleLabel). */
    role: string
    /** Until when they're acting in it, worded. */
    acting: string | null
    /** Their team leader's name. */
    teamLeader: string | null
    status: string
    /** As loaded: '' for none. */
    salary: string
    dayOffCredit: string
}

const noop = () => {}

export function ProfileView({ name, photo, access, facts, onResetPassword, onEndContract }: {
    name: string
    photo: string | null
    access: ProfileAccess
    facts: ProfileFacts
    onResetPassword: () => void
    onEndContract: () => void
}) {
    const { t, locale } = useLanguage()
    const money = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
    // Typed as they are, left to right in either language, and never translated by the page.
    const typed = (text: string) => text ? <bdi dir="ltr" translate="no">{text}</bdi> : t('profile_none')
    const word = STATUS_WORD[facts.status]
    const items = [
        { label: t('email'), value: typed(facts.email) },
        { label: t('username_label'), value: typed(facts.username) },
        ...(access.role ? [{ label: t('role_label'), value: <>{facts.role}{facts.acting && <span className="ui-detail-note">{facts.acting}</span>}</> }] : []),
        ...(access.teamLeader ? [{ label: t('team_leader_label'), value: facts.teamLeader ?? t('team_leader_none') }] : []),
        ...(access.ownTeamLeader ? [{ label: t('team_leader_yours'), value: facts.teamLeader ?? t('team_leader_yours_none') }] : []),
        ...(access.status || access.endContract ? [{
            label: t('status_label'),
            value: (
                <span className="ui-detail-act">
                    <StatusBadge tone={STATUS_TONE[facts.status] ?? 'neutral'}>{word ? t(word) : facts.status}</StatusBadge>
                    {access.endContract && <Button size="sm" onClick={onEndContract}>{facts.status === 'ARCHIVED' ? t('reinstate') : t('end_contract')}</Button>}
                </span>
            ),
        }] : []),
        ...(access.company ? [{ label: t('company_label'), value: facts.company ?? t('profile_none') }] : []),
        { label: t('gender_label'), value: t(facts.gender === 'FEMALE' ? 'female' : 'male') },
        ...(access.salary ? [{ label: t('monthly_base_salary_label'), value: facts.salary ? <span className="ui-num">{money(parseFloat(facts.salary) || 0)}</span> : t('no_data_available') }] : []),
        ...(access.dayOffCredit ? [{ label: t('day_off_credit_assigned'), value: countOf(t, locale, parseFloat(facts.dayOffCredit) || 0, 'days') }] : []),
        ...(access.resetPassword ? [{ label: t('password'), value: <Button size="sm" onClick={onResetPassword}>{t('profile_reset_password')}</Button> }] : []),
    ]
    return (
        <Card>
            <PhotoRow name={name} src={photo} canChange={false} uploading={false} error={null} onFiles={noop} onRemove={noop} />
            <Details items={items} />
        </Card>
    )
}
