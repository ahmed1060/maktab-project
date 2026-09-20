import './globals.css'
import { Providers } from './providers'
import { cookies } from 'next/headers'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import type { Locale } from '@/lib/translations'
import { en } from '@/lib/translations/en'
import { ar } from '@/lib/translations/ar'
import { parseTheme, themeAttribute, THEME_COOKIE } from '@/lib/theme'

export const metadata = {
  title: 'Nizmo',
  description: 'Operations platform for companies — tasks, workforce, leave, payroll and clients in one system.',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // cookies() is async since Next 15, which makes this layout async too.
  const cookieStore = await cookies()
  const initialLocale = (cookieStore.get('NEXT_LOCALE')?.value || 'en') as Locale
  const dir = initialLocale === 'ar' ? 'rtl' : 'ltr'

  // Resolved here, server-side, exactly as the locale is — and for the same
  // reason. A client-side-only toggle paints the light theme first and then
  // repaints, which is a white flash on every single page load and is worse
  // than having no dark mode at all.
  //
  // The cookie rather than the session, because this has to work on pages with
  // no session: the login screen, forgot-password. The signed-in preference is
  // written to the cookie when it changes, so the two stay in step.
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value)
  const themeAttr = themeAttribute(theme)

  // F-24: resolved here, server-side, and passed down as a plain prop
  // rather than imported inside a Client Component — this is a Server
  // Component, so importing both dictionaries costs nothing in the
  // client bundle; only the one matching initialLocale actually crosses
  // the server/client boundary as serialized data.
  const initialDict = initialLocale === 'ar' ? ar : en

  return (
    <html lang={initialLocale} dir={dir} data-theme={themeAttr}>
      <body>
        <Providers initialLocale={initialLocale} initialDict={initialDict} initialTheme={theme}>{children}</Providers>
        <Analytics />
        {/* Speed Insights reports the route pattern, not the URL: its
            computeRoute substitutes the dynamic segments back in, so
            /dashboard/employees/<uuid> is sent as /dashboard/employees/[id]
            and no employee id leaves the browser. Worth stating, because this
            app's routes are full of identifiers and a field-metrics tool that
            reported raw paths would be exporting them to a third party.

            Both scripts are same-origin (/_vercel/...), so the Report-Only CSP
            in next.config.mjs already covers them under 'self' — no directive
            change, and nothing new to allow if that policy is ever enforced. */}
        <SpeedInsights />
      </body>
    </html>
  )
}
