import { withSentryConfig } from '@sentry/nextjs/config';

// F-19: no security headers at all before this — not even the trivial
// x-powered-by: Next.js removal. CSP is Content-Security-Policy-Report-Only,
// not enforcing: it logs violations to the browser console instead of
// blocking anything, so it can't break the app the way a wrong enforcing
// policy could. This has not been run against live traffic, so treat the
// directives below as a starting point — watch the console on the pages
// that hit the HERE API and Supabase storage (task locations, avatars,
// attachments) before ever switching this to Content-Security-Policy.
// maps.hereapi.com: HERE's map images for placing a check-in place's pin
// (components/PointPicker.tsx).
const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co https://maps.hereapi.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co https://revgeocode.search.hereapi.com https://autosuggest.search.hereapi.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
    poweredByHeader: false,
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: '**.supabase.co',
                port: '',
                pathname: '/storage/v1/object/public/**',
            },
        ],
    },
    async headers() {
        return [{
            source: '/:path*',
            headers: [
                { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'X-Frame-Options', value: 'DENY' },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                // geolocation=(self): components/LocationSearchInput.tsx and the
                // task submission flow use navigator.geolocation from this origin.
                { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
                { key: 'Content-Security-Policy-Report-Only', value: csp },
            ],
        }, {
            // The check-in page, alone, may use the front camera: the face check
            // (lib/mobile/face-prototype). A later header with the same key wins.
            source: '/dashboard/check-in',
            headers: [
                { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
            ],
        }]
    },
};

// withSentryConfig only wires up source-map upload and the instrumentation
// hook; it doesn't send anything anywhere on its own — actual reporting is
// controlled by whether SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN are set (see
// sentry.*.config.ts). SENTRY_AUTH_TOKEN is optional and only needed to
// upload source maps for readable stack traces in the Sentry UI.
export default withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: true,
    widenClientFileUpload: true,
    // Browser events go to /monitoring on this site and are forwarded from
    // there, instead of straight to sentry.io. Ad and tracker blockers drop
    // requests to sentry.io — which would hide the very errors worth seeing —
    // and a same-origin request is already allowed by the CSP's connect-src.
    // proxy.ts leaves the path alone.
    tunnelRoute: '/monitoring',
    webpack: {
        treeshake: { removeDebugLogging: true },
        automaticVercelMonitors: false,
    },
});
