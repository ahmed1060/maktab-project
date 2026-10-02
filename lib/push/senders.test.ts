import { describe, it, expect, beforeEach } from "vitest"
import { generateKeyPairSync, verify } from "node:crypto"
import { fcmAccount, sendFcm, resetFcmToken } from "./fcm"
import { apnsAccount, sendApns, resetApnsToken, type ApnsTransport } from "./apns"

/**
 * The two push senders (lib/push): what they send, signed with what, and how
 * they read the answer. Real keys, a fake network.
 */

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString())
const message = { title: "Nizmo", body: "Your check-in was accepted.", link: "/dashboard/attendance?tab=punches" }

describe("Firebase Cloud Messaging", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const account = fcmAccount({ FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: "nizmo-test", client_email: "push@nizmo-test.iam.gserviceaccount.com", private_key: privateKey.export({ format: "pem", type: "pkcs8" }) }) })!
    let calls: { url: string; init: RequestInit }[]
    let answer: { status: number; body: string }
    const fakeFetch = (async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "access-1", expires_in: 3600 }), { status: 200 })
        return new Response(answer.body, { status: answer.status })
    }) as typeof fetch

    beforeEach(() => { calls = []; answer = { status: 200, body: "{}" }; resetFcmToken() })

    it("reads the service account, and nothing without one", () => {
        expect(account).toMatchObject({ projectId: "nizmo-test", clientEmail: "push@nizmo-test.iam.gserviceaccount.com" })
        expect(fcmAccount({})).toBeNull()
        expect(fcmAccount({ FCM_SERVICE_ACCOUNT: "not json" })).toBeNull()
    })

    it("signs for an access token with the service account's key, then sends the message to the token", async () => {
        expect(await sendFcm(account, "device-token", message, fakeFetch)).toBe("SENT")
        const assertion = new URLSearchParams(String(calls[0].init.body)).get("assertion")!
        const [head, claims, signature] = assertion.split(".")
        expect(decode(head)).toEqual({ alg: "RS256", typ: "JWT" })
        expect(decode(claims)).toMatchObject({ iss: account.clientEmail, aud: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/firebase.messaging" })
        expect(verify("RSA-SHA256", Buffer.from(`${head}.${claims}`), publicKey, Buffer.from(signature, "base64url"))).toBe(true)
        expect(calls[1].url).toBe("https://fcm.googleapis.com/v1/projects/nizmo-test/messages:send")
        expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer access-1")
        expect(JSON.parse(String(calls[1].init.body))).toEqual({
            message: { token: "device-token", notification: { title: "Nizmo", body: message.body }, data: { link: message.link }, android: { priority: "HIGH" } },
        })
        // The access token is reused while it lasts.
        await sendFcm(account, "device-token", message, fakeFetch)
        expect(calls.filter(c => c.url.includes("oauth2"))).toHaveLength(1)
    })

    it("says when the token is no longer the phone's, and when it just failed", async () => {
        answer = { status: 404, body: JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }) }
        expect(await sendFcm(account, "t", message, fakeFetch)).toBe("INVALID_TOKEN")
        answer = { status: 400, body: JSON.stringify({ error: { message: "The registration token is not a valid FCM registration token" } }) }
        expect(await sendFcm(account, "t", message, fakeFetch)).toBe("INVALID_TOKEN")
        answer = { status: 503, body: "unavailable" }
        expect(await sendFcm(account, "t", message, fakeFetch)).toBe("FAILED")
    })
})

describe("Apple Push Notification service", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const env = { APNS_KEY: String(privateKey.export({ format: "pem", type: "pkcs8" })), APNS_KEY_ID: "KEY123", APNS_TEAM_ID: "TEAM456" }
    let sent: { url: string; headers: Record<string, string>; body: string }[]
    let answer: { status: number; body: string }
    const transport: ApnsTransport = async (url, headers, body) => { sent.push({ url, headers, body }); return answer }

    beforeEach(() => { sent = []; answer = { status: 200, body: "" }; resetApnsToken() })

    it("reads the key, with the bundle and environment, and nothing without one", () => {
        expect(apnsAccount(env)).toMatchObject({ keyId: "KEY123", teamId: "TEAM456", bundleId: "com.shsd.nizmo", sandbox: false })
        expect(apnsAccount({ ...env, APNS_SANDBOX: "true", APNS_BUNDLE_ID: "com.example.app" })).toMatchObject({ sandbox: true, bundleId: "com.example.app" })
        expect(apnsAccount({ APNS_KEY_ID: "K", APNS_TEAM_ID: "T" })).toBeNull()
    })

    it("sends an alert to the device, signed ES256 with the key", async () => {
        expect(await sendApns(apnsAccount(env)!, "abc123", message, transport)).toBe("SENT")
        const [{ url, headers, body }] = sent
        expect(url).toBe("https://api.push.apple.com/3/device/abc123")
        expect(headers).toMatchObject({ "apns-topic": "com.shsd.nizmo", "apns-push-type": "alert", "apns-priority": "10" })
        const [head, claims, signature] = headers.authorization.replace("bearer ", "").split(".")
        expect(decode(head)).toEqual({ alg: "ES256", kid: "KEY123" })
        expect(decode(claims)).toMatchObject({ iss: "TEAM456" })
        expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true)
        expect(JSON.parse(body)).toEqual({ aps: { alert: { title: "Nizmo", body: message.body }, sound: "default" }, link: message.link })
        await sendApns(apnsAccount({ ...env, APNS_SANDBOX: "true" })!, "abc123", message, transport)
        expect(sent[1].url).toBe("https://api.sandbox.push.apple.com/3/device/abc123")
    })

    it("says when the token is no longer the phone's, and when it just failed", async () => {
        const account = apnsAccount(env)!
        answer = { status: 410, body: JSON.stringify({ reason: "Unregistered" }) }
        expect(await sendApns(account, "t", message, transport)).toBe("INVALID_TOKEN")
        answer = { status: 400, body: JSON.stringify({ reason: "BadDeviceToken" }) }
        expect(await sendApns(account, "t", message, transport)).toBe("INVALID_TOKEN")
        answer = { status: 500, body: JSON.stringify({ reason: "InternalServerError" }) }
        expect(await sendApns(account, "t", message, transport)).toBe("FAILED")
        expect(await sendApns(account, "t", message, async () => { throw new Error("no network") })).toBe("FAILED")
    })
})
