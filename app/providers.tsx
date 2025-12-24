'use client'

import { SessionProvider } from "next-auth/react"
import { CompanyProvider } from "@/context/CompanyContext"
import { ToastProvider } from "@/context/ToastContext"
import { HeaderProvider } from "@/context/HeaderContext"
import { LanguageProvider } from "@/context/LanguageContext"
import { Locale } from "@/lib/translations"

export function Providers({ children, initialLocale }: { children: React.ReactNode, initialLocale: Locale }) {
    return (
        <SessionProvider>
            <LanguageProvider initialLocale={initialLocale}>
                <CompanyProvider>
                    <HeaderProvider>
                        <ToastProvider>
                            {children}
                        </ToastProvider>
                    </HeaderProvider>
                </CompanyProvider>
            </LanguageProvider>
        </SessionProvider>
    )
}
