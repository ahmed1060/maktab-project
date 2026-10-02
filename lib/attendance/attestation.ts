/**
 * Proof that a request came from our genuine, unmodified app on a genuine
 * phone (ATTENDANCE_PLAN.md §9.4): Google Play Integrity on Android, Apple App
 * Attest on iOS. Both need the app published under our own developer accounts,
 * which do not exist yet.
 *
 * Until they do, attestation is in **testing**: nothing is verified, nothing
 * is refused for it, and every check-in is flagged ATTESTATION_UNVERIFIED for
 * the Super Admin to look at (the product owner's decision, 2 October 2026,
 * "accepted and flagged for super admin to review for testing purpose").
 * Set ATTENDANCE_ATTESTATION=required once the verifiers below are written
 * and configured: from then on an unverified phone is refused, as §9.6 says.
 */

export type AttestationMode = "testing" | "required"

export function attestationMode(env: Record<string, string | undefined> = process.env): AttestationMode {
    return env.ATTENDANCE_ATTESTATION === "required" ? "required" : "testing"
}

/** What the phone sent to prove itself, and the one-time number the proof must cover. */
export type Attestation = { platform: "ANDROID" | "IOS"; token?: string | null; challenge: string }

/**
 * Whether the phone proved itself. No verifier is configured yet, so the
 * answer is always no; what follows from that is attestationMode()'s to say.
 */
export async function verifyAttestation(attestation: Attestation): Promise<{ verified: boolean; reason: string | null }> {
    return { verified: false, reason: attestation.token ? "NOT_CONFIGURED" : "MISSING" }
}
