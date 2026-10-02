import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto"

/**
 * The key a phone checks in with (ATTENDANCE_PLAN.md §9.2). It is made inside
 * the phone's secure hardware (Android Keystore, iOS Secure Enclave), which
 * makes ECDSA keys on the P-256 curve; the private half never leaves it. The
 * phone sends the public half once, as SubjectPublicKeyInfo DER in base64,
 * and from then on signs what the server asks it to.
 */

export type PhoneKey = { key: KeyObject; fingerprint: string; der: Buffer }

/** The key, if it is an ECDSA P-256 public key; null for anything else. */
export function parsePhoneKey(base64: string): PhoneKey | null {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 512) return null
    const der = Buffer.from(base64, "base64")
    let key: KeyObject
    try {
        key = createPublicKey({ key: der, format: "der", type: "spki" })
    } catch {
        return null
    }
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return null
    // Written back in its one canonical form, so the same key can't be registered twice in two spellings.
    const canonical = key.export({ format: "der", type: "spki" })
    return { key, der: canonical, fingerprint: createHash("sha256").update(canonical).digest("hex") }
}

export { signedText } from "./signed-text"

/**
 * Whether this signature over this text was made with this key's private
 * half. Android and iOS both give DER signatures; a bare 64-byte one is read
 * as r‖s, which some libraries produce.
 */
export function signatureValid(key: KeyObject, text: string, signatureBase64: string): boolean {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64) || signatureBase64.length > 256) return false
    const signature = Buffer.from(signatureBase64, "base64")
    try {
        return verify("sha256", Buffer.from(text, "utf8"), { key, dsaEncoding: signature.length === 64 ? "ieee-p1363" : "der" }, signature)
    } catch {
        return false
    }
}
