import { generateKeyPairSync, sign } from "node:crypto"

/**
 * A stand-in for a phone's key pair in tests, as its secure hardware would
 * make it: ECDSA P-256. Never used outside tests.
 */
export function phoneKeyPair() {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const publicBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64")
    return {
        publicBase64,
        sign: (text: string, encoding: "der" | "ieee-p1363" = "der") => sign("sha256", Buffer.from(text), { key: privateKey, dsaEncoding: encoding }).toString("base64"),
    }
}
