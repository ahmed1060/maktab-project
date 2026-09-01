'use client'

import { SessionProvider } from "next-auth/react"
import { SWRConfig } from "swr"
import { CompanyProvider } from "@/context/CompanyContext"
import { ToastProvider } from "@/context/ToastContext"
import { HeaderProvider } from "@/context/HeaderContext"
import { LanguageProvider } from "@/context/LanguageContext"
import type { Locale, TranslationDict } from "@/lib/translations"
import AuthInterceptor from "@/components/AuthInterceptor"

export function Providers({ children, initialLocale, initialDict }: { children: React.ReactNode, initialLocale: Locale, initialDict: TranslationDict }) {
    return (
        <SessionProvider
            refetchOnWindowFocus={false}
            refetchInterval={5 * 60}
        >
            <SWRConfig value={{
                revalidateOnFocus: false,
                shouldRetryOnError: false
            }}>
                <AuthInterceptor />
                <LanguageProvider initialLocale={initialLocale} initialDict={initialDict}>
                    <CompanyProvider>
                        <HeaderProvider>
                            <ToastProvider>
                                {children}
                            </ToastProvider>
                        </HeaderProvider>
                    </CompanyProvider>
                </LanguageProvider>
            </SWRConfig>
        </SessionProvider>
    )
}
