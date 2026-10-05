'use client'

import { SessionProvider } from "next-auth/react"
import { SWRConfig } from "swr"
import { CompanyProvider } from "@/context/CompanyContext"
import { ToastProvider } from "@/context/ToastContext"
import { HeaderProvider } from "@/context/HeaderContext"
import { LanguageProvider } from "@/context/LanguageContext"
import type { Locale, TranslationDict } from "@/lib/translations"
import AuthInterceptor from "@/components/AuthInterceptor"
import StepUpInterceptor from "@/components/StepUpInterceptor"
import { ThemeProvider } from "@/context/ThemeContext"
import type { Theme } from "@/lib/theme"

export function Providers({ children, initialLocale, initialDict, initialTheme, themeChosen }: { children: React.ReactNode, initialLocale: Locale, initialDict: TranslationDict, initialTheme: Theme, themeChosen: boolean }) {
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
                    {/* A high-risk action asks for an authenticator code here,
                        for every screen at once (ROLES_PLAN.md §6.15). */}
                    <StepUpInterceptor />
                    {/* Inside SessionProvider: it persists the choice to the
                        account, which needs to know who is signed in. */}
                    <ThemeProvider initialTheme={initialTheme} themeChosen={themeChosen}>
                    <CompanyProvider>
                        <HeaderProvider>
                            <ToastProvider>
                                {children}
                            </ToastProvider>
                        </HeaderProvider>
                    </CompanyProvider>
                    </ThemeProvider>
                </LanguageProvider>
            </SWRConfig>
        </SessionProvider>
    )
}
