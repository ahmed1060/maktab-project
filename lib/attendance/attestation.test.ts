import { describe, it, expect, beforeEach } from "vitest"
import { createHash, generateKeyPairSync } from "node:crypto"
import { resetGoogleTokens } from "@/lib/google-auth"
import { attestedText, verifyAttestation } from "./attestation"
import { playIntegrityConfig } from "./play-integrity"
import { fakeAppAttestKey } from "./fixtures/fake-app-attest"
import dev from "./fixtures/app-attest-development.json"

/**
 * Attestation (lib/attendance/attestation.ts, ATTENDANCE_PLAN.md §9.4): which
 * verifier a phone's proof goes to, over what, and the reason given when it
 * doesn't pass. Play Integrity against a fake Google; App Attest with a key
 * we hold (assertions) and Apple's own output (attestations).
 */

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const SERVICE_ACCOUNT = JSON.stringify({ project_id: "nizmo", client_email: "integrity@nizmo.iam.gserviceaccount.com", private_key: privateKey.export({ format: "pem", type: "pkcs8" }) })
const CERT = "AB:CD:" + "00:".repeat(29) + "EF"
const androidEnv = { PLAY_INTEGRITY_SERVICE_ACCOUNT: SERVICE_ACCOUNT, PLAY_INTEGRITY_CERT_SHA256: CERT }
const now = new Date("2026-10-02T09:00:00Z")
const challenge = "a-one-time-number-from-the-server-0123456"
const nonceFor = (purpose: "REGISTER" | "CHECK_IN") => createHash("sha256").update(attestedText(purpose, challenge)).digest().toString("base64url")

describe("Play Integrity, on Android", () => {
    let calls: { url: string; init: RequestInit }[]
    let answer: { status: number; body: unknown }
    const google = (async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), { status: 200 })
        return new Response(JSON.stringify(answer.body), { status: answer.status })
    }) as typeof fetch
    const genuine = (over: Record<string, unknown> = {}) => ({
        tokenPayloadExternal: {
            requestDetails: { requestPackageName: "com.shsd.nizmo", nonce: nonceFor("CHECK_IN"), timestampMillis: String(now.getTime() - 5_000) },
            appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", packageName: "com.shsd.nizmo", certificateSha256Digest: [Buffer.from(CERT.replace(/:/g, ""), "hex").toString("base64url")], versionCode: "1" },
            deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
            ...over,
        },
    })
    const check = (purpose: "REGISTER" | "CHECK_IN" = "CHECK_IN", env: Record<string, string> = androidEnv) =>
        verifyAttestation({ platform: "ANDROID", token: "integrity-token", challenge, purpose }, { env, fetchImpl: google, now })

    beforeEach(() => { calls = []; answer = { status: 200, body: genuine() }; resetGoogleTokens() })

    it("has Google decode the token for our package, with the integrity scope, and passes a genuine verdict", async () => {
        expect(await check()).toEqual({ verified: true, reason: null })
        const claims = JSON.parse(Buffer.from(new URLSearchParams(String(calls[0].init.body)).get("assertion")!.split(".")[1], "base64url").toString())
        expect(claims.scope).toBe("https://www.googleapis.com/auth/playintegrity")
        expect(calls[1].url).toBe("https://playintegrity.googleapis.com/v1/com.shsd.nizmo:decodeIntegrityToken")
        expect(JSON.parse(String(calls[1].init.body))).toEqual({ integrity_token: "integrity-token" })
        // The nonce Google echoes may come back padded, or in the other alphabet.
        const padded = Buffer.from(nonceFor("CHECK_IN"), "base64url").toString("base64")
        answer.body = genuine({ requestDetails: { requestPackageName: "com.shsd.nizmo", nonce: padded, timestampMillis: now.getTime() } })
        expect(await check()).toEqual({ verified: true, reason: null })
    })

    it("refuses a token over another number, or the same number for the other purpose", async () => {
        expect(await check("REGISTER")).toEqual({ verified: false, reason: "NONCE_MISMATCH" })
    })

    it("says why each other verdict doesn't pass", async () => {
        const cases: [Record<string, unknown>, string][] = [
            [{ requestDetails: { requestPackageName: "com.other", nonce: nonceFor("CHECK_IN"), timestampMillis: now.getTime() } }, "WRONG_APP"],
            [{ requestDetails: { requestPackageName: "com.shsd.nizmo", nonce: nonceFor("CHECK_IN"), timestampMillis: now.getTime() - 11 * 60_000 } }, "STALE"],
            [{ appIntegrity: { appRecognitionVerdict: "UNRECOGNIZED_VERSION", packageName: "com.shsd.nizmo" } }, "APP_NOT_RECOGNIZED"],
            [{ appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", packageName: "com.shsd.nizmo", certificateSha256Digest: ["c29tZXRoaW5nIGVsc2U"] } }, "WRONG_CERTIFICATE"],
            [{ deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_BASIC_INTEGRITY"] } }, "DEVICE_NOT_TRUSTED"],
            [{ deviceIntegrity: {} }, "DEVICE_NOT_TRUSTED"],
        ]
        for (const [over, reason] of cases) {
            answer.body = genuine(over)
            expect(await check(), reason).toEqual({ verified: false, reason })
        }
    })

    it("tells a token Google can't read from Google being unreachable", async () => {
        answer = { status: 400, body: { error: { message: "Invalid integrity token" } } }
        expect(await check()).toEqual({ verified: false, reason: "INVALID_TOKEN" })
        answer = { status: 503, body: {} }
        expect(await check()).toEqual({ verified: false, reason: "UNAVAILABLE" })
        const down = (async () => { throw new Error("ECONNRESET") }) as typeof fetch
        expect(await verifyAttestation({ platform: "ANDROID", token: "t", challenge, purpose: "CHECK_IN" }, { env: androidEnv, fetchImpl: down, now })).toEqual({ verified: false, reason: "UNAVAILABLE" })
    })

    it("asks nobody without a service account, and nothing without a token", async () => {
        expect(await check("CHECK_IN", {})).toEqual({ verified: false, reason: "NOT_CONFIGURED" })
        expect(await verifyAttestation({ platform: "ANDROID", token: null, challenge, purpose: "CHECK_IN" }, { env: androidEnv, fetchImpl: google, now })).toEqual({ verified: false, reason: "MISSING" })
        expect(calls).toEqual([])
    })

    it("reads its settings: the push account by default, a package, certificates as hex or base64url", () => {
        expect(playIntegrityConfig({ FCM_SERVICE_ACCOUNT: SERVICE_ACCOUNT })).toMatchObject({ packageName: "com.shsd.nizmo", certDigests: [] })
        const config = playIntegrityConfig({ ...androidEnv, ATTENDANCE_ANDROID_PACKAGE: "com.example", PLAY_INTEGRITY_CERT_SHA256: `${CERT}, q83vAA` })!
        expect(config.packageName).toBe("com.example")
        expect(config.certDigests).toEqual([Buffer.from(CERT.replace(/:/g, ""), "hex").toString("base64url"), "q83vAA"])
    })
})

describe("App Attest, on iOS", () => {
    const appId = "TEAM123456.com.shsd.nizmo"
    const iosEnv = { APP_ATTEST_APP_ID: appId }
    const key = fakeAppAttestKey(appId)
    const phone: { appAttestKey: string | null; appAttestCounter: number; appAttestEnvironment?: string | null } = { appAttestKey: key.publicKey, appAttestCounter: 3 }
    const assert = (token: string | null, p: typeof phone | null = phone, env: Record<string, string> = iosEnv) =>
        verifyAttestation({ platform: "IOS", token, challenge, purpose: "CHECK_IN", phone: p }, { env, now })

    it("passes a check-in signed by the key kept at registration, and gives the counter to keep", async () => {
        const assertion = key.assertion(attestedText("CHECK_IN", challenge), 4)
        expect(await assert(JSON.stringify({ assertion }))).toEqual({ verified: true, reason: null, appAttest: { counter: 4 } })
    })

    it("passes a development build's key only while development builds are allowed (review on #65)", async () => {
        // Registered from Xcode while APP_ATTEST_ALLOW_DEVELOPMENT was set: once it is removed for production, the
        // phone kept passing as attested.
        const assertion = JSON.stringify({ assertion: key.assertion(attestedText("CHECK_IN", challenge), 4) })
        const fromXcode = { ...phone, appAttestEnvironment: "development" }
        expect(await assert(assertion, fromXcode, { ...iosEnv, APP_ATTEST_ALLOW_DEVELOPMENT: "1" })).toEqual({ verified: true, reason: null, appAttest: { counter: 4 } })
        expect(await assert(assertion, fromXcode)).toEqual({ verified: false, reason: "WRONG_ENVIRONMENT" })
        // A store build's key, and one kept before environments were: production's.
        expect(await assert(assertion, { ...phone, appAttestEnvironment: "production" })).toMatchObject({ verified: true })
        expect(await assert(assertion, { ...phone, appAttestEnvironment: null })).toMatchObject({ verified: true })
    })

    it("refuses a replayed counter, another number, another key", async () => {
        expect(await assert(JSON.stringify({ assertion: key.assertion(attestedText("CHECK_IN", challenge), 3) }))).toMatchObject({ verified: false, reason: "BAD_COUNTER" })
        expect(await assert(JSON.stringify({ assertion: key.assertion(attestedText("REGISTER", challenge), 9) }))).toMatchObject({ verified: false, reason: "BAD_SIGNATURE" })
        const other = fakeAppAttestKey(appId)
        expect(await assert(JSON.stringify({ assertion: other.assertion(attestedText("CHECK_IN", challenge), 9) }))).toMatchObject({ verified: false, reason: "BAD_SIGNATURE" })
    })

    it("can't check a phone that has no attested key, or a token that isn't one", async () => {
        const assertion = key.assertion(attestedText("CHECK_IN", challenge), 4)
        expect(await assert(JSON.stringify({ assertion }), { appAttestKey: null, appAttestCounter: 0 })).toEqual({ verified: false, reason: "NO_ATTESTED_KEY" })
        expect(await assert("not json")).toEqual({ verified: false, reason: "MALFORMED" })
        expect(await assert(JSON.stringify({ attestation: "x" }))).toEqual({ verified: false, reason: "MALFORMED" })
        expect(await assert(JSON.stringify({ assertion: "AAAA" }))).toEqual({ verified: false, reason: "MALFORMED" })
        expect(await assert(JSON.stringify({ assertion }), phone, {})).toEqual({ verified: false, reason: "NOT_CONFIGURED" })
    })

    it("checks a registration's attestation over our text: Apple's, for its own number, isn't for ours", async () => {
        // Apple's real attestation for the sample app, sent with our app ID and our number: it reaches the verifier and fails there.
        const token = JSON.stringify({ keyId: dev.keyId, attestation: dev.attestation })
        const out = await verifyAttestation({ platform: "IOS", token, challenge, purpose: "REGISTER" }, { env: { ...iosEnv, APP_ATTEST_ALLOW_DEVELOPMENT: "1" }, now: new Date("2024-06-01T00:00:00Z") })
        expect(out).toEqual({ verified: false, reason: "NONCE_MISMATCH" })
        expect(await verifyAttestation({ platform: "IOS", token: JSON.stringify({ keyId: 1 }), challenge, purpose: "REGISTER" }, { env: iosEnv })).toEqual({ verified: false, reason: "MALFORMED" })
    })
})
