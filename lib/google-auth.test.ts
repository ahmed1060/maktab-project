import { describe, it, expect, beforeEach } from "vitest"
import { generateKeyPairSync } from "node:crypto"
import { googleAccessToken, parseServiceAccount, resetGoogleTokens } from "./google-auth"

/**
 * Access tokens for Google APIs (lib/google-auth.ts), now shared by push and
 * Play Integrity: one token per account and scope, kept until it runs out.
 */

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const account = parseServiceAccount(JSON.stringify({ project_id: "p", client_email: "a@p.iam.gserviceaccount.com", private_key: privateKey.export({ format: "pem", type: "pkcs8" }) }))!

describe("Google access tokens", () => {
    let issued: string[]
    const fakeFetch = (async (_url: string, init: RequestInit) => {
        const claims = JSON.parse(Buffer.from(new URLSearchParams(String(init.body)).get("assertion")!.split(".")[1], "base64url").toString())
        issued.push(claims.scope)
        return new Response(JSON.stringify({ access_token: `token-${issued.length}`, expires_in: 3600 }), { status: 200 })
    }) as typeof fetch

    beforeEach(() => { issued = []; resetGoogleTokens() })

    it("keeps a token per scope: one API's token is never sent to another", async () => {
        const now = Date.parse("2026-10-02T09:00:00Z")
        expect(await googleAccessToken(account, "scope/push", fakeFetch, now)).toBe("token-1")
        expect(await googleAccessToken(account, "scope/integrity", fakeFetch, now)).toBe("token-2")
        expect(await googleAccessToken(account, "scope/push", fakeFetch, now + 60_000)).toBe("token-1")
        expect(issued).toEqual(["scope/push", "scope/integrity"])
        // A minute before it runs out, a new one.
        expect(await googleAccessToken(account, "scope/push", fakeFetch, now + 3_540_000)).toBe("token-3")
    })

    it("refuses what isn't a service-account key", () => {
        expect(parseServiceAccount(undefined)).toBeNull()
        expect(parseServiceAccount("{}")).toBeNull()
        expect(parseServiceAccount("nope")).toBeNull()
    })
})
