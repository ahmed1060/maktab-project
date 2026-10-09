import { createHash } from "node:crypto"
import { AppAttestError, verifyAppAssertion, verifyAppAttestation, type AppAttestConfig } from "./app-attest"
import { playIntegrityConfig, verifyPlayIntegrity } from "./play-integrity"
import { attestedText, type SignedPurpose } from "./signed-text"

/**
 * Proof that a request came from our genuine, unmodified app on a genuine
 * phone (ATTENDANCE_PLAN.md §9.4): Google Play Integrity on Android, Apple App
 * Attest on iOS.
 *
 * While attestation is in **testing**, nothing is refused for it: every
 * check-in it doesn't verify is flagged ATTESTATION_UNVERIFIED for the Super
 * Admin to look at, with the reason (the product owner's decision, 2 October
 * 2026, "accepted and flagged for super admin to review for testing
 * purpose"). Set ATTENDANCE_ATTESTATION=required once the app is published
 * and the verifiers are configured: from then on an unverified phone is
 * refused, as §9.6 says.
 *
 * Configuration:
 * - Android: PLAY_INTEGRITY_SERVICE_ACCOUNT (or FCM_SERVICE_ACCOUNT) with
 *   the Play Integrity API enabled; ATTENDANCE_ANDROID_PACKAGE (default
 *   com.shsd.nizmo); PLAY_INTEGRITY_CERT_SHA256, optional.
 * - iOS: APP_ATTEST_APP_ID, "TEAMID.bundle.id"; APP_ATTEST_ALLOW_DEVELOPMENT=1
 *   for builds run from Xcode.
 */

export type AttestationMode = "testing" | "required"

export function attestationMode(env: Record<string, string | undefined> = process.env): AttestationMode {
    return env.ATTENDANCE_ATTESTATION === "required" ? "required" : "testing"
}

export type AttestationPurpose = SignedPurpose
export { attestedText }

/** What the phone sent to prove itself, and the one-time number the proof must cover. */
export type Attestation = {
    platform: "ANDROID" | "IOS"
    token?: string | null
    challenge: string
    purpose: AttestationPurpose
    /** At check-in, the App Attest key kept from the phone's registration (iOS). */
    phone?: { appAttestKey: string | null; appAttestCounter: number; appAttestEnvironment?: string | null } | null
}

export type AttestationResult = {
    verified: boolean
    /** Why not, for whoever reviews it: MISSING, NOT_CONFIGURED, or what the check found. */
    reason: string | null
    /**
     * App Attest: at registration, the key to keep; at check-in, the counter
     * to keep, which only goes up. The caller stores it, only if the counter
     * kept is still lower, in the same transaction as what it proves.
     */
    appAttest?: { publicKey?: string; counter: number; environment?: "production" | "development" }
}

type Env = Record<string, string | undefined>

function appAttestConfig(env: Env): AppAttestConfig | null {
    if (!env.APP_ATTEST_APP_ID) return null
    return { appId: env.APP_ATTEST_APP_ID, allowDevelopment: env.APP_ATTEST_ALLOW_DEVELOPMENT === "1" }
}

const no = (reason: string): AttestationResult => ({ verified: false, reason })

/** Whether the phone proved itself; what follows from that is attestationMode()'s to say. */
export async function verifyAttestation(
    attestation: Attestation,
    deps: { env?: Env; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<AttestationResult> {
    const env = deps.env ?? process.env
    const token = attestation.token
    if (!token) return no("MISSING")
    if (typeof token !== "string" || token.length > 20_000) return no("MALFORMED")
    const text = attestedText(attestation.purpose, attestation.challenge)

    if (attestation.platform === "ANDROID") {
        const config = playIntegrityConfig(env)
        if (!config) return no("NOT_CONFIGURED")
        const nonce = createHash("sha256").update(text, "utf8").digest()
        const out = await verifyPlayIntegrity({ token, nonce, config, fetchImpl: deps.fetchImpl, now: deps.now })
        return out.ok ? { verified: true, reason: null } : no(out.reason)
    }

    const config = appAttestConfig(env)
    if (!config) return no("NOT_CONFIGURED")
    let sent: { keyId?: unknown; attestation?: unknown; assertion?: unknown }
    try {
        sent = JSON.parse(token)
    } catch {
        return no("MALFORMED")
    }
    try {
        if (attestation.purpose === "REGISTER") {
            if (typeof sent.keyId !== "string" || typeof sent.attestation !== "string") return no("MALFORMED")
            const out = verifyAppAttestation({ attestation: Buffer.from(sent.attestation, "base64"), keyId: sent.keyId, challenge: text, config, now: deps.now })
            return { verified: true, reason: null, appAttest: { publicKey: out.publicKey, counter: out.counter, environment: out.environment } }
        }
        if (typeof sent.assertion !== "string") return no("MALFORMED")
        // A phone registered before attestation was set up, or that failed it, has no key to check with.
        if (!attestation.phone?.appAttestKey) return no("NO_ATTESTED_KEY")
        // A key from a development build, kept while those were allowed, counts only while they still are: removed for
        // production, its phone is no longer attested (review on #65).
        if (attestation.phone.appAttestEnvironment === "development" && !config.allowDevelopment) return no("WRONG_ENVIRONMENT")
        const out = verifyAppAssertion({
            assertion: Buffer.from(sent.assertion, "base64"), challenge: text,
            publicKey: attestation.phone.appAttestKey, previousCounter: attestation.phone.appAttestCounter, config,
        })
        return { verified: true, reason: null, appAttest: { counter: out.counter } }
    } catch (error) {
        if (error instanceof AppAttestError) return no(error.reason)
        throw error
    }
}
