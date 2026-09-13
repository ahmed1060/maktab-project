'use client'

import React, { createContext, useContext } from 'react'
import type { CompanyBranding } from '@/lib/company-scope'

/**
 * The branding this screen is scoped to, or null for "read the session".
 *
 * Resolved once per request in the dashboard layout and handed down, rather
 * than fetched here. That is what makes the sidebar, the page headings and the
 * browser tab title agree by construction: there is one answer per render, not
 * one per component that went looking.
 *
 * Null is the ordinary case. It means rule 3 — a company's own users see their
 * own company, which is already on their session — or rule 2, a Super Admin on
 * All Companies, who sees the built-in defaults.
 */
const CompanyBrandingContext = createContext<CompanyBranding | null>(null)

export function CompanyBrandingProvider({
    value,
    children,
}: {
    value: CompanyBranding | null
    children: React.ReactNode
}) {
    return <CompanyBrandingContext.Provider value={value}>{children}</CompanyBrandingContext.Provider>
}

export function useCompanyBranding() {
    return useContext(CompanyBrandingContext)
}
