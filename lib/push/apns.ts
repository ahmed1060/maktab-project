import { connect } from "node:http2"
import { sign } from "node:crypto"
import type { PushMessage, PushOutcome } from "./fcm"

/**
 * Pushes to iPhones through Apple's Push Notification service
 * (ATTENDANCE_PLAN.md §13.4). The app's push plugin gives an APNs device
 * token, so iPhones are reached directly, not through Firebase.
 *
 * Set up by APNS_KEY (the .p8 key's PEM text), APNS_KEY_ID, APNS_TEAM_ID,
 * and optionally APNS_BUNDLE_ID (default com.shsd.nizmo) and
 * APNS_SANDBOX=true for development builds. Without the key nothing is sent.
 * APNs speaks HTTP/2 only, so this uses node:http2 rather than fetch.
 */

export type ApnsAccount = { key: string; keyId: string; teamId: string; bundleId: string; sandbox: boolean }

/** One request to APNs; replaceable in tests. */
export type ApnsTransport = (url: string, headers: Record<string, string>, body: string) => Promise<{ status: number; body: string }>

export function apnsAccount(env: Record<string, string | undefined> = process.env): ApnsAccount | null {
    if (!env.APNS_KEY || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) return null
    return {
        key: env.APNS_KEY.replace(/\\n/g, "\n"), keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID,
        bundleId: env.APNS_BUNDLE_ID || "com.shsd.nizmo", sandbox: env.APNS_SANDBOX === "true",
    }
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url")

let cached: { keyId: string; jwt: string; issuedAt: number } | null = null

/** For tests: forget the cached provider token. */
export function resetApnsToken() {
    cached = null
}

/** The provider token: ES256, reused for up to 50 minutes (Apple refuses one older than an hour). */
function providerToken(account: ApnsAccount, now: number): string {
    if (cached && cached.keyId === account.keyId && now - cached.issuedAt < 50 * 60_000) return cached.jwt
    const head = base64url(JSON.stringify({ alg: "ES256", kid: account.keyId }))
    const claims = base64url(JSON.stringify({ iss: account.teamId, iat: Math.floor(now / 1000) }))
    const signature = base64url(sign("sha256", Buffer.from(`${head}.${claims}`), { key: account.key, dsaEncoding: "ieee-p1363" }))
    const jwt = `${head}.${claims}.${signature}`
    cached = { keyId: account.keyId, jwt, issuedAt: now }
    return jwt
}

const http2Transport: ApnsTransport = (url, headers, body) => new Promise((resolve, reject) => {
    const target = new URL(url)
    const session = connect(target.origin)
    session.on("error", reject)
    const req = session.request({ ":method": "POST", ":path": target.pathname, ...headers })
    let status = 0
    let text = ""
    req.setEncoding("utf8")
    req.on("response", h => { status = Number(h[":status"]) })
    req.on("data", chunk => { text += chunk })
    req.on("end", () => { session.close(); resolve({ status, body: text }) })
    req.on("error", e => { session.close(); reject(e) })
    req.end(body)
})

/** Sends one message to one iPhone. A token the phone no longer holds says so, to be forgotten. */
export async function sendApns(account: ApnsAccount, token: string, message: PushMessage, transport: ApnsTransport = http2Transport, now = Date.now()): Promise<PushOutcome> {
    const host = account.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com"
    try {
        const res = await transport(`${host}/3/device/${encodeURIComponent(token)}`, {
            authorization: `bearer ${providerToken(account, now)}`,
            "apns-topic": account.bundleId,
            "apns-push-type": "alert",
            "apns-priority": "10",
        }, JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: "default" }, ...(message.link ? { link: message.link } : {}) }))
        if (res.status === 200) return "SENT"
        // 410 Unregistered: the app was removed. BadDeviceToken: not a token for this app and environment.
        if (res.status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(res.body)) return "INVALID_TOKEN"
        return "FAILED"
    } catch {
        return "FAILED"
    }
}
