import { sign } from "node:crypto"

/**
 * Pushes to Android phones through Firebase Cloud Messaging, HTTP v1
 * (ATTENDANCE_PLAN.md §13.4). Set up by FCM_SERVICE_ACCOUNT, the Firebase
 * project's service-account key as JSON; without it nothing is sent.
 *
 * No SDK: a short-lived access token from Google's token endpoint, signed
 * with the service account's key, then one POST per message.
 */

export type FcmAccount = { projectId: string; clientEmail: string; privateKey: string }
export type PushMessage = { title: string; body: string; link: string | null }
export type PushOutcome = "SENT" | "INVALID_TOKEN" | "FAILED"
type Fetch = typeof fetch

export function fcmAccount(env: Record<string, string | undefined> = process.env): FcmAccount | null {
    const raw = env.FCM_SERVICE_ACCOUNT
    if (!raw) return null
    try {
        const json = JSON.parse(raw)
        if (!json.project_id || !json.client_email || !json.private_key) return null
        return { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key }
    } catch {
        return null
    }
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url")
const TOKEN_URL = "https://oauth2.googleapis.com/token"

let cached: { email: string; token: string; expiresAt: number } | null = null

/** For tests: forget the cached access token. */
export function resetFcmToken() {
    cached = null
}

async function accessToken(account: FcmAccount, fetchImpl: Fetch, now: number): Promise<string> {
    if (cached && cached.email === account.clientEmail && cached.expiresAt - 60_000 > now) return cached.token
    const iat = Math.floor(now / 1000)
    const head = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    const claims = base64url(JSON.stringify({
        iss: account.clientEmail, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: TOKEN_URL, iat, exp: iat + 3600,
    }))
    const signature = base64url(sign("RSA-SHA256", Buffer.from(`${head}.${claims}`), account.privateKey))
    const res = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${signature}` }).toString(),
    })
    if (!res.ok) throw new Error(`FCM token request failed: ${res.status}`)
    const json = await res.json() as { access_token: string; expires_in: number }
    cached = { email: account.clientEmail, token: json.access_token, expiresAt: now + json.expires_in * 1000 }
    return json.access_token
}

/** Sends one message to one phone. A token the phone no longer holds says so, to be forgotten. */
export async function sendFcm(account: FcmAccount, token: string, message: PushMessage, fetchImpl: Fetch = fetch, now = Date.now()): Promise<PushOutcome> {
    try {
        const bearer = await accessToken(account, fetchImpl, now)
        const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`, {
            method: "POST",
            headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                message: {
                    token,
                    notification: { title: message.title, body: message.body },
                    data: message.link ? { link: message.link } : {},
                    android: { priority: "HIGH" },
                },
            }),
        })
        if (res.ok) return "SENT"
        // UNREGISTERED: the app was removed or the token rotated. A malformed token is just as dead.
        const text = await res.text()
        if (res.status === 404 || (res.status === 400 && /registration token|UNREGISTERED/i.test(text))) return "INVALID_TOKEN"
        return "FAILED"
    } catch {
        return "FAILED"
    }
}
