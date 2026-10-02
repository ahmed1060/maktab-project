import { googleAccessToken, parseServiceAccount, resetGoogleTokens, type ServiceAccount } from "@/lib/google-auth"

/**
 * Pushes to Android phones through Firebase Cloud Messaging, HTTP v1
 * (ATTENDANCE_PLAN.md §13.4). Set up by FCM_SERVICE_ACCOUNT, the Firebase
 * project's service-account key as JSON; without it nothing is sent.
 *
 * No SDK: a short-lived access token from Google's token endpoint, signed
 * with the service account's key, then one POST per message.
 */

export type FcmAccount = ServiceAccount
export type PushMessage = { title: string; body: string; link: string | null }
export type PushOutcome = "SENT" | "INVALID_TOKEN" | "FAILED"
type Fetch = typeof fetch

export function fcmAccount(env: Record<string, string | undefined> = process.env): FcmAccount | null {
    return parseServiceAccount(env.FCM_SERVICE_ACCOUNT)
}

/** For tests: forget the cached access token. */
export function resetFcmToken() {
    resetGoogleTokens()
}

const accessToken = (account: FcmAccount, fetchImpl: Fetch, now: number) =>
    googleAccessToken(account, "https://www.googleapis.com/auth/firebase.messaging", fetchImpl, now)

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
        // Only FCM's own word that the token is dead (review on #25): UNREGISTERED
        // (the app was removed, the token rotated) or a malformed token. A 404
        // for a wrong project is our setup, not the phone's, and must not wipe
        // every token in the run.
        const text = await res.text()
        if ((res.status === 404 || res.status === 400) && /UNREGISTERED|not a valid FCM registration token/i.test(text)) return "INVALID_TOKEN"
        return "FAILED"
    } catch {
        return "FAILED"
    }
}
