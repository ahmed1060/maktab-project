import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto"

/**
 * For tests: an App Attest key we hold ourselves, making assertions the way
 * an iPhone does (authenticator data, signed over it and the client data's
 * hash, CBOR). An attestation needs Apple's signature, so those come from
 * the real fixtures instead.
 */

const sha256 = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest()

/** Just the CBOR an assertion is: a map of two text keys to byte strings. */
function cborBytes(value: Buffer): Buffer {
    const head = value.length < 24 ? Buffer.from([0x40 | value.length]) : value.length < 256 ? Buffer.from([0x58, value.length]) : Buffer.from([0x59, value.length >> 8, value.length & 0xff])
    return Buffer.concat([head, value])
}
const cborText = (value: string) => Buffer.concat([Buffer.from([0x60 | value.length]), Buffer.from(value)])

export function fakeAppAttestKey(appId: string) {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
    return {
        /** As the server keeps it: SubjectPublicKeyInfo DER, base64. */
        publicKey: (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64"),
        /** A check-in's assertion, base64, over the client data, with this counter. */
        assertion(clientData: string, counter: number, signer: KeyObject = privateKey): string {
            const authData = Buffer.alloc(37)
            sha256(Buffer.from(appId)).copy(authData, 0)
            authData[32] = 0x40
            authData.writeUInt32BE(counter, 33)
            const signature = sign("sha256", sha256(authData, sha256(Buffer.from(clientData, "utf8"))), signer)
            return Buffer.concat([Buffer.from([0xa2]), cborText("signature"), cborBytes(signature), cborText("authenticatorData"), cborBytes(authData)]).toString("base64")
        },
    }
}
