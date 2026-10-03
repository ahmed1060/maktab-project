import { sign } from "node:crypto"

/**
 * An access token for a Google API, from a service account's key: a JWT
 * signed with the account's private key, exchanged at Google's token
 * endpoint. Used for Firebase Cloud Messaging and Play Integrity; no SDK.
 * Cached per account and scope until a minute before it runs out.
 */

export type ServiceAccount = { projectId: string; clientEmail: string; privateKey: string }
type Fetch = typeof fetch

/** A service-account key as Google gives it, JSON; null for anything else. */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
    if (!raw) return null
    try {
        const json = JSON.parse(raw)
        if (!json.project_id || !json.client_email || !json.private_key) return null
        return { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key }
    } catch {
        return null
    }
}

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url")
const cache = new Map<string, { token: string; expiresAt: number }>()

/** For tests: forget the cached tokens. */
export function resetGoogleTokens() {
    cache.clear()
}

export async function googleAccessToken(account: ServiceAccount, scope: string, fetchImpl: Fetch = fetch, now = Date.now()): Promise<string> {
    const key = `${account.clientEmail} ${scope}`
    const hit = cache.get(key)
    if (hit && hit.expiresAt - 60_000 > now) return hit.token
    const iat = Math.floor(now / 1000)
    const head = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    const claims = base64url(JSON.stringify({ iss: account.clientEmail, scope, aud: TOKEN_URL, iat, exp: iat + 3600 }))
    const signature = base64url(sign("RSA-SHA256", Buffer.from(`${head}.${claims}`), account.privateKey))
    const res = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${signature}` }).toString(),
    })
    if (!res.ok) throw new Error(`Google token request failed: ${res.status}`)
    const json = await res.json() as { access_token: string; expires_in: number }
    cache.set(key, { token: json.access_token, expiresAt: now + json.expires_in * 1000 })
    return json.access_token
}
