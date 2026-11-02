'use client'

import { useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { BuildingsIcon, CurrencyDollarIcon, HourglassIcon, PackageIcon, PencilSimpleIcon, PlusIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { refusalOf } from '@/components/CompanyRolesCard'
import DeleteTemplateDialog from '@/components/DeleteTemplateDialog'
import { PackageDialog, type ListedPackage } from '@/components/PackageDialog'
import { Button, DataList, EmptyState, ItemTitle, ListCard, Page, PageHeader, RowMenu, StatusBadge, type Column, type MenuItem } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { countOf } from '@/lib/plural'
import { bundleLabelKeys, platformMoney } from '@/lib/subscription-display'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useViewer } from '@/lib/useCan'

/**
 * The packages companies are sold (the Super Admin's pages part 3b,
 * UI_PLAN.md §5 step 5): what each grants, its prices and how many
 * companies are on it, a table on computers and cards on phones. Retired ones
 * stay listed: retiring one only stops it being given to more companies, and
 * a package that can't be seen can't be brought back.
 */
export default function PackagesPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    // Who is looking comes from the layout on the first paint, so a Super
    // Admin never sees "Access restricted" while the session loads.
    const viewer = useViewer()
    const isSuperAdmin = viewer?.role === 'SUPER_ADMIN'

    const { data, error, isValidating, mutate } = useSWR(isSuperAdmin ? '/api/packages?includeInactive=true' : null, fetcher)
    const packages: ListedPackage[] | null = data?.data ?? null

    const [editing, setEditing] = useState<ListedPackage | 'new' | null>(null)
    const [removing, setRemoving] = useState<ListedPackage | null>(null)
    const [busy, setBusy] = useState(false)

    if (!isSuperAdmin) return <AccessDenied />

    const said = (key: Parameters<typeof t>[0], name: string) => t(key).replace('{name}', name)
    const money = (n: number) => platformMoney(n, locale)
    const companiesOn = (p: ListedPackage) => p._count?.companies ?? 0

    const remove = async (p: ListedPackage) => {
        setBusy(true)
        try {
            const res = await fetch(`/api/packages?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(said('packages_deleted', p.name), 'success')
            setRemoving(null)
            await mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    // A package companies are on can't be deleted, which would give them
    // every module: its Delete stays in the menu, greyed, saying why.
    const menu = (p: ListedPackage) => {
        const inUse = companiesOn(p) > 0
        const items: MenuItem[] = [
            { key: 'edit', label: t('edit'), icon: PencilSimpleIcon, onSelect: () => setEditing(p) },
            { key: 'delete', label: inUse ? t('packages_delete_in_use') : t('delete'), icon: TrashIcon, danger: true, disabled: inUse || undefined, onSelect: () => setRemoving(p) },
        ]
        return <RowMenu label={t('ui_more_actions_for').replace('{name}', p.name)} tooltip={t('ui_more_actions')} items={items} />
    }
    const badges = (p: ListedPackage) => <>
        {!p.isActive && <>{' '}<StatusBadge tone="neutral">{t('package_retired')}</StatusBadge></>}
        {!p.isPublic && <>{' '}<StatusBadge tone="neutral">{t('packages_unlisted')}</StatusBadge></>}
    </>
    const name = (p: ListedPackage) => <><bdi>{p.name}</bdi>{badges(p)}</>
    const grants = (p: ListedPackage) => {
        const keys = bundleLabelKeys(p)
        return keys.length === 0 ? t('core_only') : keys.map(k => t(k)).join(t('list_separator'))
    }
    const prices = (p: ListedPackage) => [
        t('packages_per_month').replace('{price}', money(p.priceMonthly)),
        t('packages_per_year').replace('{price}', money(p.priceAnnual)),
        p.priceLifetime === null ? t('packages_not_for_life') : t('packages_for_life').replace('{price}', money(p.priceLifetime)),
    ]

    const columns: Column<ListedPackage>[] = [
        { key: 'name', header: t('packages_package'), cell: p => <ItemTitle title={name(p)} detail={p.description} /> },
        { key: 'grants', header: t('packages_grants'), cell: grants },
        { key: 'prices', header: t('packages_prices'), cell: p => prices(p).map((line, i) => <div key={i} className="ui-num">{line}</div>) },
        { key: 'companies', header: t('companies'), align: 'end', cell: p => <span className="ui-num">{companiesOn(p).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}</span> },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: menu },
    ]

    let list: ReactNode
    if (!packages) {
        list = error ? (
            <div className="ui-panel">
                <EmptyState icon={WarningCircleIcon} title={t('packages_load_failed')} detail={(error as SWRError).info?.error}
                    action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
            </div>
        ) : (
            <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        )
    } else {
        list = (
            <DataList
                caption={t('packages')}
                columns={columns}
                rows={packages}
                rowKey={p => p.id}
                empty={<EmptyState icon={PackageIcon} title={t('packages_none')} detail={t('packages_none_hint')} />}
                card={p => (
                    <ListCard
                        title={name(p)}
                        details={[
                            { icon: PackageIcon, text: grants(p) },
                            { icon: CurrencyDollarIcon, text: prices(p).join(t('list_separator')) },
                            { icon: BuildingsIcon, text: countOf(t, locale, companiesOn(p), 'companies') },
                        ]}
                        foot={<><span className="ui-hint">{p.description}</span>{menu(p)}</>}
                    />
                )}
            />
        )
    }

    return (
        <Page>
            <PageHeader
                title={t('packages')}
                subtitle={t('packages_hint')}
                action={<Button variant="primary" icon={PlusIcon} onClick={() => setEditing('new')}>{t('packages_add')}</Button>}
            />
            {list}

            {editing && (
                <PackageDialog
                    pkg={editing === 'new' ? null : editing}
                    onClose={() => setEditing(null)}
                    onSaved={(saved, added) => {
                        setEditing(null)
                        showToast(said(added ? 'packages_added' : 'packages_saved', saved), 'success')
                        void mutate()
                    }}
                />
            )}
            {removing && (
                <DeleteTemplateDialog
                    name={removing.name}
                    body={t('packages_delete_body')}
                    busy={busy}
                    onCancel={() => setRemoving(null)}
                    onConfirm={() => { void remove(removing) }}
                />
            )}
        </Page>
    )
}
