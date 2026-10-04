import type { CapacitorConfig } from "@capacitor/cli"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

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

// The offline page's "Try again" goes back to the site, which only this build knows: written beside it
// (www/site.js, not committed) each time the config is read, so it can't drift from server.url.
const checkIn = `${site}/dashboard/check-in`
// Capacitor reads this config from the mobile/ folder, where it must be run.
writeFileSync(join(process.cwd(), "www", "site.js"), `window.NIZMO_SITE = ${JSON.stringify(checkIn)}\n`)

const config: CapacitorConfig = {
    appId: "com.shsd.nizmo",
    appName: "Nizmo",
    // The offline page (www/index.html), shown when the site can't be reached, instead of the web view's own error.
    webDir: "www",
    server: {
        url: checkIn,
        cleartext: false,
        errorPath: "index.html",
    },
    android: { allowMixedContent: false },
    plugins: {
        // Play Integrity (§9.4): the Google Cloud project the server decodes tokens with,
        // NIZMO_CLOUD_PROJECT_NUMBER. A build installed from Play can do without it.
        NizmoCheckIn: { cloudProjectNumber: process.env.NIZMO_CLOUD_PROJECT_NUMBER ?? "" },
    },
}

export default config
