/**
 * Shell for the public legal documents at /privacy and /terms.
 *
 * Its own route group rather than a path segment, so the URLs stay short —
 * Google's OAuth consent screen wants a privacy policy link, and a shorter
 * one is easier to read back over the phone than /legal/privacy.
 *
 * Deliberately outside every auth boundary. middleware.ts only demands a
 * token for paths starting /dashboard, so these render for a signed-out
 * visitor with no exception added; that matters because Google fetches the
 * URL without a session, and a page that redirects to /login fails its check.
 *
 * dir is pinned to ltr rather than inherited. The root layout sets direction
 * from the locale cookie, and these documents are English-only (see the
 * governing-language note at the foot of each), so an Arabic-locale visitor
 * would otherwise get right-aligned English.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
    return (
        <div
            dir="ltr"
            style={{
                minHeight: '100vh',
                background: 'var(--surface-subtle)',
                color: 'var(--text-body)',
                padding: '3rem 1.5rem 5rem',
            }}
        >
            <div style={{ maxWidth: '44rem', margin: '0 auto' }}>
                <a
                    href="/login"
                    style={{
                        display: 'inline-block',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'var(--brand-primary-text)',
                        textDecoration: 'none',
                        marginBottom: '2rem',
                    }}
                >
                    Nizmo
                </a>

                <article className="legal">{children}</article>

                <footer
                    style={{
                        marginTop: '3.5rem',
                        paddingTop: '1.5rem',
                        borderTop: '1px solid var(--border)',
                        fontSize: '0.85rem',
                        color: 'var(--text-faint)',
                        display: 'flex',
                        gap: '1.5rem',
                        flexWrap: 'wrap',
                    }}
                >
                    <a href="/privacy" style={{ color: 'var(--text-soft)' }}>Privacy Policy</a>
                    <a href="/terms" style={{ color: 'var(--text-soft)' }}>Terms of Service</a>
                    <a href="/login" style={{ color: 'var(--text-soft)' }}>Sign in</a>
                </footer>
            </div>
        </div>
    )
}
