import './globals.css'
import '@/components/ui/ui.css'
import { Providers } from './providers'
import { cookies, headers } from 'next/headers'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { resolveLocale } from '@/lib/locale'
import { en } from '@/lib/translations/en'
import { ar } from '@/lib/translations/ar'
import { parseTheme, themeAttribute, THEME_COOKIE } from '@/lib/theme'
import { brandStyleSheet } from '@/lib/brand-colour'
import { defaultBrandColour } from '@/lib/page-brand-colour'
import NavigationProgress from '@/components/NavigationProgress'
import { Suspense } from 'react'

// The typefaces, defined once for every page that draws its own <html>
// (app/fonts.ts).
import { fontVariables } from './fonts'

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
  const initialLocale = resolveLocale(cookieStore.get('NEXT_LOCALE')?.value, (await headers()).get('accept-language'))
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

  // The default brand colour (UI_PLAN.md §4.6). Here, server-side, for the
  // same reason as the theme: so the page never opens in another colour
  // first. The default and not the viewer's: this layout isn't drawn again
  // when the app moves to another page, so it can't follow somebody signing
  // in or out. The dashboard layout draws a company's own colour over it
  // (lib/page-brand-colour.ts).
  const brand = await defaultBrandColour()

  return (
    <html lang={initialLocale} dir={dir} data-theme={themeAttr} className={fontVariables}>
      <head>
        {/* The default brand colour's shades (DESIGN.md §2.1), in the page
            before it's sent so it never opens in another colour first. */}
        <style id="brand-colour" dangerouslySetInnerHTML={{ __html: brandStyleSheet(brand) }} />
      </head>
      <body>
        <Providers initialLocale={initialLocale} initialDict={initialDict} initialTheme={theme} themeChosen={cookieStore.has(THEME_COOKIE)}>{children}</Providers>
        {/* useSearchParams needs a Suspense boundary of its own. */}
        <Suspense fallback={null}><NavigationProgress /></Suspense>
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
