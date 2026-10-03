import { createHash, createPublicKey, verify, X509Certificate } from "node:crypto"
import { decodeCbor, type Cbor } from "./cbor"
import { APPLE_APP_ATTEST_ROOT } from "./apple-app-attest-root"

/**
 * Apple App Attest, checked on the server (ATTENDANCE_PLAN.md §9.4), as Apple
 * describes it in "Validating apps that connect to your server":
 *
 * - When a phone registers, its app makes an App Attest key inside the Secure
 *   Enclave and has Apple attest it, over a hash of our one-time number. The
 *   attestation proves the key belongs to our genuine app on a genuine
 *   iPhone. We keep the key.
 * - On each check-in the app signs a hash of that check-in's one-time number
 *   with the key (an assertion), with a counter that only goes up.
 *
 * The client data hashed is the one-time number as text, in both.
 */

const sha256 = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest()

/** Our app's ID as Apple knows it: team ID and bundle ID, "ABCDE12345.com.shsd.nizmo". */
export type AppAttestConfig = { appId: string; allowDevelopment: boolean; root?: string }

export type AttestFailure =
    | "MALFORMED" | "BAD_CHAIN" | "NONCE_MISMATCH" | "KEY_MISMATCH" | "WRONG_APP" | "BAD_COUNTER" | "WRONG_ENVIRONMENT" | "BAD_SIGNATURE"

export class AppAttestError extends Error {
    constructor(readonly reason: AttestFailure) { super(reason) }
}

const fail = (reason: AttestFailure): never => { throw new AppAttestError(reason) }

/** Apple's extension in the key's certificate holding the nonce: 1.2.840.113635.100.8.2. */
const NONCE_OID = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02])
const PRODUCTION = Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)])
const DEVELOPMENT = Buffer.from("appattestdevelop")

/**
 * Checks an attestation made when the phone registered. Gives the key's
 * public half (SubjectPublicKeyInfo DER, base64) to keep for its assertions.
 */
export function verifyAppAttestation(input: {
    attestation: Buffer; keyId: string; challenge: string; config: AppAttestConfig; now?: Date
}): { publicKey: string; counter: number; environment: "production" | "development" } {
    const { config } = input
    const now = input.now ?? new Date()
    const object = asMap(safeDecode(input.attestation))
    if (object.get("fmt") !== "apple-appattest") fail("MALFORMED")
    const statement = asMap(object.get("attStmt"))
    const x5c = statement.get("x5c")
    const authData = object.get("authData")
    if (!Array.isArray(x5c) || x5c.length < 2 || !Buffer.isBuffer(authData) || authData.length < 55) fail("MALFORMED")
    const [leafDer, intermediateDer] = x5c as Buffer[]

    // 1. The key's certificate, through Apple's intermediate, to Apple's root.
    let leaf: X509Certificate, intermediate: X509Certificate
    try {
        leaf = new X509Certificate(leafDer)
        intermediate = new X509Certificate(intermediateDer)
    } catch {
        return fail("MALFORMED")
    }
    const root = new X509Certificate(config.root ?? APPLE_APP_ATTEST_ROOT)
    const current = (c: X509Certificate) => new Date(c.validFrom) <= now && now <= new Date(c.validTo)
    if (!leaf.verify(intermediate.publicKey) || !intermediate.verify(root.publicKey) || !current(leaf) || !current(intermediate)) fail("BAD_CHAIN")

    // 2–4. The nonce in the certificate is the hash of the attested data and our number's hash.
    const nonce = sha256(authData as Buffer, sha256(Buffer.from(input.challenge, "utf8")))
    if (!nonceOf(leafDer).equals(nonce)) fail("NONCE_MISMATCH")

    // 5. The key ID is the hash of the certificate's public key.
    const spki = leaf.publicKey.export({ type: "spki", format: "der" })
    const point = spki.subarray(spki.length - 65)
    const keyId = Buffer.from(input.keyId, "base64")
    if (!sha256(point).equals(keyId)) fail("KEY_MISMATCH")

    // 6–9. Our app, a fresh key, the expected environment, the same key ID.
    const data = authData as Buffer
    if (!data.subarray(0, 32).equals(sha256(Buffer.from(config.appId, "utf8")))) fail("WRONG_APP")
    const counter = data.readUInt32BE(33)
    if (counter !== 0) fail("BAD_COUNTER")
    const aaguid = data.subarray(37, 53)
    const environment = aaguid.equals(PRODUCTION) ? "production" : aaguid.equals(DEVELOPMENT) ? "development" : fail("WRONG_ENVIRONMENT")
    if (environment === "development" && !config.allowDevelopment) fail("WRONG_ENVIRONMENT")
    const idLength = data.readUInt16BE(53)
    if (!data.subarray(55, 55 + idLength).equals(keyId)) fail("KEY_MISMATCH")

    return { publicKey: Buffer.from(spki).toString("base64"), counter, environment }
}

/** Checks a check-in's assertion with the key kept from registration. Gives the new counter, which must be kept. */
export function verifyAppAssertion(input: {
    assertion: Buffer; challenge: string; publicKey: string; previousCounter: number; config: AppAttestConfig
}): { counter: number } {
    const object = asMap(safeDecode(input.assertion))
    const signature = object.get("signature")
    const authData = object.get("authenticatorData")
    if (!Buffer.isBuffer(signature) || !Buffer.isBuffer(authData) || authData.length < 37) return fail("MALFORMED")
    const nonce = sha256(authData, sha256(Buffer.from(input.challenge, "utf8")))
    let key
    try {
        key = createPublicKey({ key: Buffer.from(input.publicKey, "base64"), format: "der", type: "spki" })
    } catch {
        return fail("MALFORMED")
    }
    if (!verify("sha256", nonce, key, signature)) fail("BAD_SIGNATURE")
    if (!authData.subarray(0, 32).equals(sha256(Buffer.from(input.config.appId, "utf8")))) fail("WRONG_APP")
    // Only ever up: an assertion replayed, or from a copy of the app's state, can't count again.
    const counter = authData.readUInt32BE(33)
    if (counter <= input.previousCounter) fail("BAD_COUNTER")
    return { counter }
}

function safeDecode(data: Buffer): Cbor {
    try {
        return decodeCbor(data)
    } catch {
        return fail("MALFORMED")
    }
}

function asMap(value: Cbor): Map<Cbor, Cbor> {
    return value instanceof Map ? value : fail("MALFORMED")
}

/** One DER TLV at a position: where its contents start and end. */
function tlv(der: Buffer, at: number): { tag: number; start: number; end: number } {
    if (at + 2 > der.length) fail("MALFORMED")
    const tag = der[at]
    let length = der[at + 1]
    let start = at + 2
    if (length & 0x80) {
        const bytes = length & 0x7f
        if (bytes === 0 || bytes > 4 || start + bytes > der.length) fail("MALFORMED")
        length = der.readUIntBE(start, bytes)
        start += bytes
    }
    if (start + length > der.length) fail("MALFORMED")
    return { tag, start, end: start + length }
}

/**
 * The nonce in Apple's extension: OCTET STRING { SEQUENCE { [1] { OCTET STRING nonce } } },
 * after the extension's OID (and its critical flag, if there is one).
 */
function nonceOf(certDer: Buffer): Buffer {
    const oidAt = certDer.indexOf(NONCE_OID)
    if (oidAt < 0) return fail("NONCE_MISMATCH")
    let next = tlv(certDer, oidAt + NONCE_OID.length)
    if (next.tag === 0x01) next = tlv(certDer, next.end)
    if (next.tag !== 0x04) return fail("MALFORMED")
    const sequence = tlv(certDer, next.start)
    if (sequence.tag !== 0x30) return fail("MALFORMED")
    const tagged = tlv(certDer, sequence.start)
    if (tagged.tag !== 0xa1) return fail("MALFORMED")
    const octets = tlv(certDer, tagged.start)
    if (octets.tag !== 0x04) return fail("MALFORMED")
    return certDer.subarray(octets.start, octets.end)
}
