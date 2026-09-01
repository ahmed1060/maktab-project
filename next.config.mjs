import { withSentryConfig } from '@sentry/nextjs/config';

/** @type {import('next').NextConfig} */
const nextConfig = {
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
    webpack: {
        treeshake: { removeDebugLogging: true },
        automaticVercelMonitors: false,
    },
});
