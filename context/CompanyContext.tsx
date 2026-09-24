'use client'

import React, { createContext, useContext, useState, useEffect, useSyncExternalStore } from 'react'
import { SCOPED_COMPANY_COOKIE } from '@/lib/company-scope'
import { hasCompanySelection, readCompanySelection, subscribeCompanySelection, writeCompanySelection } from '@/lib/company-selection'

type CompanyContextType = {
    selectedCompanyId: string | null
    setSelectedCompanyId: (id: string | null) => void
    refreshTrigger: number
    triggerRefresh: () => void
}

const CompanyContext = createContext<CompanyContextType>({
    selectedCompanyId: null,
    setSelectedCompanyId: () => { },
    refreshTrigger: 0,
    triggerRefresh: () => { }
})

export const CompanyProvider = ({ children }: { children: React.ReactNode }) => {
    const [refreshTrigger, setRefreshTrigger] = useState(0)

    // Mirrored into a cookie as well as localStorage. The cookie is the only
    // one of the two a Server Component can read, and the dashboard layout
    // needs this before first paint to render a scoped Super Admin's sidebar
    // with the right company's names rather than the defaults and a correction
    // one frame later. Not a credential and not httpOnly — the client is what
    // writes it, and the server ignores it for anyone but a Super Admin.
    const writeScopeCookie = (id: string | null) => {
        const value = id || 'ALL'
        document.cookie = `${SCOPED_COMPANY_COOKIE}=${encodeURIComponent(value)};path=/;max-age=31536000;samesite=lax`
    }

    // Read from storage as an external store rather than copied into state by
    // an effect. Hydration still renders All Companies first (the server has
    // no localStorage) and then the stored choice, exactly as before; what
    // changes is that there is one copy of the value instead of two that an
    // effect keeps in step, and other tabs are followed.
    const selectedCompanyId = useSyncExternalStore(subscribeCompanySelection, readCompanySelection, () => null)

    // Seeds the cookie for a session that chose its company before the cookie
    // existed, so an existing selection starts being honoured server-side
    // without anyone having to pick it again.
    useEffect(() => {
        if (hasCompanySelection()) writeScopeCookie(readCompanySelection())
    }, [])

    const setSelectedCompanyId = (id: string | null) => {
        writeScopeCookie(id)
        writeCompanySelection(id)
    }

    const triggerRefresh = () => {
        setRefreshTrigger(prev => prev + 1)
    }

    return (
        <CompanyContext.Provider value={{ selectedCompanyId, setSelectedCompanyId, refreshTrigger, triggerRefresh }}>
            {children}
        </CompanyContext.Provider>
    )
}

export const useCompany = () => useContext(CompanyContext)
