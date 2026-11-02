'use client'

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BuildingsIcon, HourglassIcon, KeyIcon, ShieldCheckIcon, UserIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { Button, Card, EmptyState, Field, Page, PageHeader, Panel, Row, SearchInput, Select, TabLinks } from '@/components/ui'
import { useCompany } from '@/context/CompanyContext'
import { useLanguage } from '@/context/LanguageContext'
import { isPermission, type Permission, type Scope } from '@/lib/permissions/catalogue'
import { PERMISSION_GROUPS, groupLabelKey, permissionLabelKey, scopeLabelKey } from '@/lib/permissions/matrix'
import { roleLabel } from '@/lib/role-label'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useViewer } from '@/lib/useCan'

/**
 * "Who can do this?" (ROLES_PLAN.md §6.5), for the Super Admin. A permission
 * → everyone in the company holding it, at which scope, through which role.
 * A person → everything they may do and through which role. What it shows is
 * read from the grants can() reads, so it is the answer, not a description.
 *
 * On the building blocks (the Super Admin's pages part 2b, UI_PLAN.md §5 step
 * 5): the company is the one in view, picked in the top bar as on every other
 * page, so it isn't picked twice (as Payroll, decided on 2026-10-31). The two
 * questions are tabs, and the question asked is kept in the address
 * (`?by=person&person=…`, `?permission=…`), so a reload or a link opens on it.
 */

type Holder = { user: { id: string; name: string; status: string }; role: { id: string; name: string; builtIn?: string | null }; scope: Scope }
type PersonAccess = {
    user: { id: string; name: string; status: string; companyId?: string | null }
    role: { name: string; builtIn?: string | null } | null
    grants: { permission: Permission; scope: Scope }[]
}
type Found = { id: string; firstName: string; lastName: string }

export default function WhoCanPage() {
    const { t } = useLanguage()
    const viewer = useViewer()
    const isSuperAdmin = viewer?.role === 'SUPER_ADMIN'
    const { selectedCompanyId: company } = useCompany()
    const params = useSearchParams()
    const pathname = usePathname()
    const router = useRouter()
    const mode = params.get('by') === 'person' ? 'person' : 'permission'
    const asked = params.get('permission') ?? ''
    const permission = isPermission(asked) ? asked : ''
    const personId = params.get('person') ?? ''
    const go = (next: Record<string, string>) => {
        const q = new URLSearchParams(params.toString())
        for (const [key, value] of Object.entries(next)) {
            if (value) q.set(key, value)
            else q.delete(key)
        }
        router.replace(`${pathname}?${q}`, { scroll: false })
    }

    // Asked of the server a moment after the typing stops, not per letter.
    const [typed, setTyped] = useState('')
    const [search, setSearch] = useState('')
    useEffect(() => {
        const id = setTimeout(() => setSearch(typed.trim()), 250)
        return () => clearTimeout(id)
    }, [typed])

    const asking = isSuperAdmin && !!company
    const holders = useSWR(asking && mode === 'permission' && permission
        ? `/api/roles/who-can?companyId=${company}&permission=${encodeURIComponent(permission)}` : null, fetcher)
    const found = useSWR(asking && mode === 'person'
        ? `/api/users?companyId=${company}&includeDeleted=false&limit=20&search=${encodeURIComponent(search)}` : null, fetcher, { keepPreviousData: true })
    const person = useSWR(asking && mode === 'person' && personId ? `/api/roles/who-can?userId=${personId}` : null, fetcher)

    if (!isSuperAdmin) return <AccessDenied />

    const tabs = (
        <TabLinks label={t('who_can_title')} items={[
            { href: `${pathname}?by=permission`, label: t('who_can_by_permission'), current: mode === 'permission' },
            { href: `${pathname}?by=person`, label: t('who_can_by_person'), current: mode === 'person' },
        ]} />
    )

    // Each fact kept apart from the next, so a name can't swap places with
    // the words beside it in Arabic (company settings part 3c).
    const facts = (items: string[]) => (
        <span>{items.map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</span>
    )
    /** What's on screen while an answer loads, and when it didn't, with Try again. */
    const pending = (answer: { error?: unknown; isValidating: boolean; mutate: () => unknown }) => answer.error ? (
        <EmptyState icon={WarningCircleIcon} title={t('who_can_load_failed')} detail={(answer.error as SWRError).info?.error}
            action={<Button busy={answer.isValidating} onClick={() => { void answer.mutate() }}>{t('try_again')}</Button>} />
    ) : (
        <div role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
    )

    let body: ReactNode
    if (!company) {
        body = <Panel><EmptyState icon={BuildingsIcon} title={t('who_can_pick_company')} /></Panel>
    } else if (mode === 'permission') {
        const list: Holder[] | null = holders.data ? holders.data.data?.holders ?? [] : null
        body = <>
            <Card>
                <Field label={t('who_can_permission')}>{p => (
                    <Select {...p} name="permission" value={permission} onChange={e => go({ permission: e.target.value })}
                        options={[{ value: '', label: t('who_can_permission_none') }]}
                        groups={PERMISSION_GROUPS.map(g => ({ label: t(groupLabelKey(g.key)), options: g.permissions.map(code => ({ value: code, label: t(permissionLabelKey(code)) })) }))} />
                )}</Field>
            </Card>
            {!permission ? (
                <Panel><EmptyState icon={KeyIcon} title={t('who_can_choose_permission')} /></Panel>
            ) : (
                <Card title={t(permissionLabelKey(permission))}>
                    {!list ? pending(holders) : list.length === 0 ? <EmptyState icon={ShieldCheckIcon} title={t('who_can_nobody')} /> : (
                        <ul className="ui-rows ui-rows-flush" aria-label={t(permissionLabelKey(permission))}>
                            {list.map(h => <Row key={h.user.id} title={<bdi>{h.user.name}</bdi>} detail={facts([roleLabel(h.role, t), t(scopeLabelKey(h.scope))])} />)}
                        </ul>
                    )}
                </Card>
            )}
        </>
    } else {
        const people: Found[] | null = found.data ? found.data.data?.data ?? [] : null
        const access: PersonAccess | null = person.data?.data ?? null
        // A person of the company in view: the top bar can change under one picked.
        const shown = access && (access.user.companyId === undefined || access.user.companyId === company) ? access : null
        const [before, after] = t('who_can_through').split('{role}')
        body = <>
            <Card>
                <Field label={t('who_can_find_person')}>{p => (
                    <SearchInput {...p} name="search" autoComplete="off" value={typed} onChange={e => setTyped(e.target.value)} />
                )}</Field>
                <fieldset className="ui-field ui-fieldset">
                    <legend className="ui-label">{t('who_can_person')}</legend>
                    <div className="ui-checklist">
                        {!people ? (found.error ? pending(found) : <p className="ui-hint" role="status">{t('loading')}</p>)
                            : people.length === 0 ? <p className="ui-hint">{t('who_can_no_people')}</p>
                            : people.map(p => (
                                <label key={p.id} className="ui-choice">
                                    <input type="radio" className="ui-radio" name="person" value={p.id} checked={p.id === personId} onChange={() => go({ person: p.id })} />
                                    <bdi>{[p.firstName, p.lastName].filter(Boolean).join(' ')}</bdi>
                                </label>
                            ))}
                    </div>
                </fieldset>
            </Card>
            {!personId || (access && !shown) ? (
                <Panel><EmptyState icon={UserIcon} title={t('who_can_pick_person')} /></Panel>
            ) : !shown ? (
                <Panel>{pending(person)}</Panel>
            ) : (
                <Card title={<bdi>{shown.user.name}</bdi>}>
                    {shown.role && <p className="ui-card-note">{before}<bdi>{roleLabel(shown.role, t)}</bdi>{after}</p>}
                    {shown.grants.length === 0 ? <EmptyState icon={ShieldCheckIcon} title={t('who_can_holds_nothing')} /> : PERMISSION_GROUPS.map(g => {
                        const held = shown.grants.filter(gr => g.permissions.includes(gr.permission))
                        if (held.length === 0) return null
                        return (
                            <section key={g.key} className="ui-subsection">
                                <h3 className="ui-subsection-title">{t(groupLabelKey(g.key))}</h3>
                                <ul className="ui-rows ui-rows-flush">
                                    {held.map(gr => <Row key={gr.permission} title={t(permissionLabelKey(gr.permission))} detail={t(scopeLabelKey(gr.scope))} />)}
                                </ul>
                            </section>
                        )
                    })}
                </Card>
            )}
        </>
    }

    return (
        <Page>
            <PageHeader title={t('who_can_title')} subtitle={t('who_can_hint')} />
            {tabs}
            {body}
        </Page>
    )
}
