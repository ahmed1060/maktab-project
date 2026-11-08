'use client'

import Link from 'next/link'
import { XIcon } from '@phosphor-icons/react/ssr'
import { CompanyMark, Icon } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useDialog } from '@/lib/useDialog'
import { countOf } from '@/lib/plural'
import { isModuleKey, type ResolvedModules } from '@/lib/modules'
import { MODULE_ICONS } from '@/lib/module-icons'
import { PAGES, type SideBarGroup, type SideBarItemKey } from '@/lib/side-bar'
import { ITEM_ICONS } from '@/lib/side-bar-icons'

/**
 * The side bar (DESIGN.md §5.1), as the mock-up of the app's frame the
 * product owner approved on 2026-11-05 draws it: the company's mark and
 * name, the groups lib/side-bar.ts gives this person, which scroll, and
 * Company settings and the rest pinned at its foot, over the privacy policy
 * and the terms.
 *
 * On a phone it's a drawer from the start side: a dialog while it's open
 * (useDialog keeps focus in it, closes it on Escape and gives focus back to
 * the menu button), and not drawn while it's closed. Where it sits is CSS
 * (.ui-side-bar, components/ui/ui.css), not `drawer`, which is known only
 * once the page has run, so the first paint is already right on both.
 */
export default function SideBar({ groups, modules, company, pathname, drawer, open, onClose, waiting }: {
    groups: SideBarGroup[]
    modules: ResolvedModules
    /** The company's name and logo; Nizmo's, for the Super Admin looking at no one company. */
    company: { name: string; logoUrl: string | null }
    pathname: string | null
    /** On a phone or a tablet: the drawer, rather than the side bar beside the page. */
    drawer: boolean
    open: boolean
    onClose: () => void
    /** How many wait on this person under the Requests page's To review tab; not known yet while undefined. */
    waiting?: number
}) {
    const { t, locale } = useLanguage()
    const asDialog = drawer && open
    const dialog = useDialog(asDialog, onClose, { label: t('nav_main_menu') })

    // The link for the page you're on says so (aria-current), and is drawn as
    // chosen. The dashboard itself only on its own page, not on every page under /dashboard.
    const here = (href: string) => pathname === href || (href !== '/dashboard' && !!pathname?.startsWith(href + '/'))
    const currentFor = (href: string) => (here(href) ? { 'aria-current': 'page' as const } : {})

    // What waits on this person under To review, on Requests (DESIGN.md §5.1); nothing when none does.
    const counted = (key: SideBarItemKey) => key === 'requests' && !!waiting && waiting > 0

    const item = (key: SideBarItemKey) => {
        // A module's name and icon are the company's where it chose its own
        // (lib/modules.ts), drawn as the others are (DESIGN.md §6).
        const entry = isModuleKey(key)
            ? { ...modules.entry(key), glyph: MODULE_ICONS[modules.icon(key)].glyph }
            : { href: PAGES[key].href, label: t(PAGES[key].labelKey), glyph: ITEM_ICONS[key] }
        return (
            <Link key={key} href={entry.href} className="ui-side-item" {...currentFor(entry.href)}
                // Picking a page closes the drawer. Prefetch stays on: a small
                // fixed set of links, and the most used way around the app.
                onClick={asDialog ? onClose : undefined}>
                <Icon icon={entry.glyph} weight={here(entry.href) ? 'fill' : 'regular'} />
                {/* The count, heard with the name: the pill beside it is hidden from screen readers. */}
                <span className="ui-side-label"><bdi>{entry.label}</bdi>{counted(key) && <span className="ui-visually-hidden">{t('side_bar_to_review').replace('{count}', countOf(t, locale, waiting!, 'requests'))}</span>}</span>
                {counted(key) && <span className="ui-side-count" aria-hidden="true">{waiting!.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}</span>}
            </Link>
        )
    }

    // Named for screen readers once: by the group, its name on screen hidden from them.
    const group = (g: SideBarGroup) => (
        <div key={g.key} role={g.labelKey ? 'group' : undefined} aria-label={g.labelKey ? t(g.labelKey) : undefined}>
            {g.labelKey && <p className="ui-side-group-name" aria-hidden="true">{t(g.labelKey)}</p>}
            {g.items.map(item)}
        </div>
    )
    const pinned = groups.filter(g => g.key === 'bottom')

    return (
        <>
            {asDialog && <div className="ui-side-scrim" aria-hidden="true" onClick={onClose} />}
            <div className="ui-side-bar" data-open={asDialog ? 'true' : 'false'} {...(asDialog ? dialog.panelProps : {})}>
                <div className="ui-side-head">
                    <CompanyMark name={company.name} logoUrl={company.logoUrl} />
                    <span className="ui-side-name"><bdi>{company.name}</bdi></span>
                    {/* The drawer's own; not shown beside the page on a computer. */}
                    <button type="button" className="ui-side-close" aria-label={t('close_menu')} onClick={onClose}>
                        <Icon icon={XIcon} size={22} />
                    </button>
                </div>
                <nav className="ui-side-nav" aria-label={t('nav_main_menu')}>
                    <div className="ui-side-groups">{groups.filter(g => g.key !== 'bottom').map(group)}</div>
                    {pinned.length > 0 && <div className="ui-side-pinned">{pinned.map(group)}</div>}
                </nav>
                {/* The legal documents live here because the app has no footer,
                    and a policy reachable only from Google's consent screen is a
                    link in a console rather than something a person can find. */}
                <p className="ui-side-legal">
                    <a href="/privacy">{t('privacy_policy')}</a>
                    <a href="/terms">{t('terms_of_service')}</a>
                </p>
            </div>
        </>
    )
}
