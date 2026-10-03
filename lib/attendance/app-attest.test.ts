import { describe, it, expect } from "vitest"
import { createPublicKey, X509Certificate } from "node:crypto"
import { verifyAppAttestation, verifyAppAssertion, AppAttestError } from "./app-attest"
import { decodeCbor } from "./cbor"
import dev from "./fixtures/app-attest-development.json"
import prod from "./fixtures/app-attest-production.json"

/**
 * App Attest, checked against Apple's own output: two real attestations and
 * a real assertion made on an iPhone (fixtures/README.md), then each way one
 * can be wrong.
 */

const appId = "V8H6LQ9448.io.uebelacker.AppAttestExample"
const config = { appId, allowDevelopment: true }
const decode = (f: typeof dev) => ({ attestation: Buffer.from(f.attestation, "base64"), keyId: f.keyId, challenge: Buffer.from(f.challenge, "base64").toString("utf8") })
const leafOf = (attestation: Buffer) => new X509Certificate(((decodeCbor(attestation) as Map<any, any>).get("attStmt") as Map<any, any>).get("x5c")[0])
const whileValid = (attestation: Buffer) => new Date(Date.parse(leafOf(attestation).validFrom) + 60_000)
const reason = (fn: () => unknown) => { try { fn(); return "PASSED" } catch (e) { return e instanceof AppAttestError ? e.reason : String(e) } }

describe("an attestation, when a phone registers", () => {
    it("accepts Apple's own, in development and in production, and gives the key to keep", () => {
        const d = decode(dev)
        const out = verifyAppAttestation({ ...d, config, now: whileValid(d.attestation) })
        expect(out).toMatchObject({ counter: 0, environment: "development" })
        // The key kept is the one the certificate holds.
        expect(createPublicKey({ key: Buffer.from(out.publicKey, "base64"), format: "der", type: "spki" }).asymmetricKeyDetails?.namedCurve).toBe("prime256v1")
        const p = decode(prod)
        expect(verifyAppAttestation({ ...p, config: { appId, allowDevelopment: false }, now: whileValid(p.attestation) })).toMatchObject({ environment: "production" })
    })

    it("refuses a development build when only production is allowed", () => {
        const d = decode(dev)
        expect(reason(() => verifyAppAttestation({ ...d, config: { appId, allowDevelopment: false }, now: whileValid(d.attestation) }))).toBe("WRONG_ENVIRONMENT")
    })

    it("refuses another number, another key, another app", () => {
        const d = decode(dev), now = whileValid(d.attestation)
        expect(reason(() => verifyAppAttestation({ ...d, challenge: "another number", config, now }))).toBe("NONCE_MISMATCH")
        expect(reason(() => verifyAppAttestation({ ...d, keyId: prod.keyId, config, now }))).toBe("KEY_MISMATCH")
        expect(reason(() => verifyAppAttestation({ ...d, config: { ...config, appId: "ABCDE12345.com.shsd.nizmo" }, now }))).toBe("WRONG_APP")
    })

    it("refuses a chain that isn't Apple's, or isn't current", () => {
        const d = decode(dev), now = whileValid(d.attestation)
        // The leaf's own intermediate posing as the root: nothing chains to it.
        const intermediate = ((decodeCbor(d.attestation) as Map<any, any>).get("attStmt") as Map<any, any>).get("x5c")[1] as Buffer
        const fake = new X509Certificate(intermediate).toString()
        expect(reason(() => verifyAppAttestation({ ...d, config: { ...config, root: fake }, now }))).toBe("BAD_CHAIN")
        expect(reason(() => verifyAppAttestation({ ...d, config, now: new Date(Date.parse(leafOf(d.attestation).validTo) + 60_000) }))).toBe("BAD_CHAIN")
    })

    it("refuses anything that isn't an attestation", () => {
        const d = decode(dev), now = whileValid(d.attestation)
        expect(reason(() => verifyAppAttestation({ ...d, attestation: Buffer.from("not cbor at all"), config, now }))).toBe("MALFORMED")
        expect(reason(() => verifyAppAttestation({ ...d, attestation: Buffer.from([0xa1, 0x63, 0x66, 0x6d, 0x74, 0x64, 0x6e, 0x6f, 0x6e, 0x65]), config, now }))).toBe("MALFORMED")
    })
})

describe("an assertion, on each check-in", () => {
    // A real assertion over this text, signed by this key (fixtures/README.md).
    const assertion = Buffer.from("omlzaWduYXR1cmVYRzBFAiBB8BGAwkmFCg1M5J0mOYEun0SUN1/lse79/7ypG9WiMQIhAIHvqj7eg59B1PMFX1CN4GMGlsgfFtdL30pHCf7G/dNRcWF1dGhlbnRpY2F0b3JEYXRhWCXKPdw7T3iujcFZbHVrHX0mDSMrNms5PzEbrFbQPRA6rEAAAAAB", "base64")
    const challenge = '{"subject":"Lorem ipsum","message":"Lorem ipsum dolor sit amet, consectetur adipiscing elit."}'
    const publicKey = createPublicKey("-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEg69t2YzgcPTLUx8Zgu+rbcikeaEL\n8Ppb+HG0QTIulz8YUB9tgv1pDRruWk87nZC3our56pzIWaqXEbaWyamdzA==\n-----END PUBLIC KEY-----\n")
        .export({ type: "spki", format: "der" }).toString("base64")

    it("accepts Apple's own, and gives the counter to keep", () => {
        expect(verifyAppAssertion({ assertion, challenge, publicKey, previousCounter: 0, config })).toEqual({ counter: 1 })
    })

    it("refuses one replayed, over another number, for another app, or from another key", () => {
        expect(reason(() => verifyAppAssertion({ assertion, challenge, publicKey, previousCounter: 1, config }))).toBe("BAD_COUNTER")
        expect(reason(() => verifyAppAssertion({ assertion, challenge: "another number", publicKey, previousCounter: 0, config }))).toBe("BAD_SIGNATURE")
        expect(reason(() => verifyAppAssertion({ assertion, challenge, publicKey, previousCounter: 0, config: { ...config, appId: "ABCDE12345.com.shsd.nizmo" } }))).toBe("WRONG_APP")
        const d = decode(dev)
        const other = verifyAppAttestation({ ...d, config, now: whileValid(d.attestation) }).publicKey
        expect(reason(() => verifyAppAssertion({ assertion, challenge, publicKey: other, previousCounter: 0, config }))).toBe("BAD_SIGNATURE")
        expect(reason(() => verifyAppAssertion({ assertion: Buffer.from([1, 2, 3]), challenge, publicKey, previousCounter: 0, config }))).toBe("MALFORMED")
    })
})

describe("the CBOR it reads", () => {
    it("reads maps, arrays, strings, bytes and integers, and refuses the rest", () => {
        // {"a": [1, -2, h'0102'], "b": true}
        expect(decodeCbor(Buffer.from("a26161830121420102616" + "2f5", "hex"))).toEqual(new Map<any, any>([["a", [1, -2, Buffer.from([1, 2])]], ["b", true]]))
        expect(() => decodeCbor(Buffer.from("9f01ff", "hex"))).toThrow("CBOR_UNSUPPORTED")
        expect(() => decodeCbor(Buffer.from("4401", "hex"))).toThrow("CBOR_TRUNCATED")
        expect(() => decodeCbor(Buffer.from("0101", "hex"))).toThrow("CBOR_TRAILING_BYTES")
    })
})
