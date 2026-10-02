import type { CapacitorConfig } from "@capacitor/cli"

/**
 * The app opens the website's check-in page (ATTENDANCE_PLAN.md §9.1): the
 * site is the app, and the native plugin (NizmoCheckIn) does what a web page
 * can't. Which site is set when the app is built, never at run time, so a
 * build can only ever talk to the server it was made for:
 *
 *   NIZMO_URL=https://your-nizmo-domain npm run sync
 */
const site = process.env.NIZMO_URL
if (!site || !/^https:\/\/[^/]+$/.test(site)) {
    throw new Error("Set NIZMO_URL to the site's address, https:// and no path, e.g. NIZMO_URL=https://nizmo.example.com")
}

const config: CapacitorConfig = {
    appId: "com.shsd.nizmo",
    appName: "Nizmo",
    // Shown only if the site can't be reached when the app starts.
    webDir: "www",
    server: {
        url: `${site}/dashboard/check-in`,
        cleartext: false,
    },
    android: { allowMixedContent: false },
    plugins: {
        // Play Integrity (§9.4): the Google Cloud project the server decodes tokens with,
        // NIZMO_CLOUD_PROJECT_NUMBER. A build installed from Play can do without it.
        NizmoCheckIn: { cloudProjectNumber: process.env.NIZMO_CLOUD_PROJECT_NUMBER ?? "" },
    },
}

export default config
