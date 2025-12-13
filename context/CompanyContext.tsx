'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'

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
    const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(null)
    const [refreshTrigger, setRefreshTrigger] = useState(0)

    // Persist selection? Maybe strict session based is better to avoid confusion.
    // Let's persist to localStorage for convenience.
    useEffect(() => {
        const stored = localStorage.getItem('selectedCompanyId')
        if (stored) setSelectedCompanyIdState(stored === 'ALL' ? null : stored)
    }, [])

    const setSelectedCompanyId = (id: string | null) => {
        setSelectedCompanyIdState(id)
        if (id) {
            localStorage.setItem('selectedCompanyId', id)
        } else {
            localStorage.setItem('selectedCompanyId', 'ALL')
        }
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
