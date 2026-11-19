'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { LockKeyIcon, SignOutIcon } from '@phosphor-icons/react/ssr'
import { Avatar, CompanyMark, Icon } from '@/components/ui'
import { AccountButton, type AccountPerson } from '@/components/DashboardHeader'
import LanguageToggleButton from '@/components/LanguageToggleButton'
import { useLanguage } from '@/context/LanguageContext'

/** One of a client's people, as the top bar names them: their name, and their client's. */
export type PortalPerson = { name: string; client: string }

/**
 * The account menu (DESIGN.md §5.5): the person at its top, with their
 * client under their name, then Change password, on a page of the area's own
 * (PR 335), and Sign out. Not a dialog, as the company's people's isn't: its
 * button is Tab's, and the top bar closes it, as following its link does.
 */
export function PortalAccountMenu({ id, person, onClose, onSignOut, signingOut }: {
    id: string
    person: PortalPerson
    onClose: () => void
    onSignOut: () => void
    signingOut: boolean
}) {
    const { t } = useLanguage()
    return (
        <div id={id} className="ui-account-menu">
            <div className="ui-account-head">
                <Avatar name={person.name} src={null} size={40} />
                <span className="ui-account-who">
                    <span className="ui-account-name"><bdi>{person.name}</bdi></span>
                    <span className="ui-account-role"><bdi>{person.client}</bdi></span>
                </span>
            </div>
            <div className="ui-menu-rule" />
            <Link className="ui-menu-item" href="/portal/password" onClick={onClose}><Icon icon={LockKeyIcon} />{t('portal_password_title')}</Link>
            <div className="ui-menu-rule" />
            <button type="button" className="ui-menu-item" onClick={onSignOut} disabled={signingOut} aria-busy={signingOut}><Icon icon={SignOutIcon} />{t('sign_out')}</button>
        </div>
    )
}

/**
 * The client's area's top bar (DESIGN.md §5.5; CLIENT_PORTAL_PLAN.md §5.3,
 * §12 step 7d-1; PR 334), alone: the company's mark and name at its start, as
 * at the top of the company's side bar; the language switch and the account
 * menu at its end. None of the company's app: no menu button, notifications,
 * company picker or search. On a phone the company's name gives way first,
 * and the switch and the account button are as on the company's top bar
 * (components/ui/ui.css).
 */
export function PortalTopBar({ company, person }: {
    company: { name: string; logoUrl: string | null }
    person: PortalPerson
}) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [leaving, setLeaving] = useState(false)
    const box = useRef<HTMLDivElement>(null)
    const button = useRef<HTMLButtonElement>(null)
    const menuId = useId()
    // The account button says the person's client where a person's says their role.
    const who: AccountPerson = { id: '', name: person.name, role: person.client, companyName: null, photo: null }

    // As the company's people's account menu signs out (components/DashboardHeader.tsx).
    const leave = async () => {
        setLeaving(true)
        await signOut({ redirect: false })
        router.push('/login')
    }

    // The menu closes on a click or a tap outside it (DESIGN.md §5.1).
    useEffect(() => {
        if (!open) return
        const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
        document.addEventListener('pointerdown', outside)
        return () => document.removeEventListener('pointerdown', outside)
    }, [open])

    return (
        <header className="ui-topbar ui-portal-topbar">
            <span className="ui-portal-company">
                <CompanyMark name={company.name} logoUrl={company.logoUrl} />
                <span className="ui-portal-company-name"><bdi>{company.name}</bdi></span>
            </span>
            <span className="ui-topbar-spacer" />
            <LanguageToggleButton />
            {/* Escape closes the menu from anywhere in it, the button included,
                and Tab past its last control closes it too, as the company's
                people's does. */}
            <div ref={box} className="ui-account"
                onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); button.current?.focus() } }}
                onBlur={e => { if (e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
                <AccountButton person={who} open={open} menuId={menuId} onToggle={() => setOpen(was => !was)} buttonRef={button} />
                {open && <PortalAccountMenu id={menuId} person={person} onClose={() => setOpen(false)} onSignOut={leave} signingOut={leaving} />}
            </div>
        </header>
    )
}
