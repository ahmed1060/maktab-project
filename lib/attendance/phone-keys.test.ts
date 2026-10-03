import { describe, it, expect } from "vitest"
import { generateKeyPairSync } from "node:crypto"
import { phoneKeyPair } from "./test-phone"
import { parsePhoneKey, signatureValid, signedText } from "./phone-keys"

describe("a phone's key (§9.2)", () => {
    it("is read when it is an ECDSA P-256 public key, with a stable fingerprint", () => {
        const phone = phoneKeyPair()
        const a = parsePhoneKey(phone.publicBase64)!
        expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/)
        expect(parsePhoneKey(phone.publicBase64)!.fingerprint).toBe(a.fingerprint)
    })

    it("is refused when it is anything else", () => {
        const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "der", type: "spki" }).toString("base64")
        const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).publicKey.export({ format: "der", type: "spki" }).toString("base64")
        for (const bad of [rsa, p384, "", "not base64!", Buffer.from("hello").toString("base64"), "A".repeat(600)]) {
            expect(parsePhoneKey(bad), bad.slice(0, 20)).toBeNull()
        }
    })
})

describe("what a phone signs", () => {
    it("is one line per part, so no two different requests read the same", () => {
        expect(signedText("CHECK_IN", "n1", ["a", 2])).toBe("nizmo-attendance/v1\nCHECK_IN\nn1\na\n2")
        expect(signedText("REGISTER", "n1", [])).not.toBe(signedText("CHECK_IN", "n1", []))
    })

    it("is accepted with the phone's own key, in DER or raw form, and nothing else", () => {
        const phone = phoneKeyPair(), other = phoneKeyPair()
        const key = parsePhoneKey(phone.publicBase64)!.key
        const text = signedText("REGISTER", "abc", ["fingerprint"])
        expect(signatureValid(key, text, phone.sign(text))).toBe(true)
        expect(signatureValid(key, text, phone.sign(text, "ieee-p1363"))).toBe(true)
        // Another phone's signature, another text, or garbage: no.
        expect(signatureValid(key, text, other.sign(text))).toBe(false)
        expect(signatureValid(key, signedText("REGISTER", "abd", ["fingerprint"]), phone.sign(text))).toBe(false)
        expect(signatureValid(key, text, "")).toBe(false)
        expect(signatureValid(key, text, "!!!")).toBe(false)
        expect(signatureValid(key, text, Buffer.alloc(70).toString("base64"))).toBe(false)
    })
})
