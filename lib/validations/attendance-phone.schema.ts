import { z } from "zod"

/** What the app sends to register its phone (ATTENDANCE_PLAN.md §9.2). The service checks the key and signature themselves. */
export const registerPhoneSchema = z.object({
    nonce: z.string().min(20).max(100),
    publicKey: z.string().min(1).max(512),
    signature: z.string().min(1).max(256),
    platform: z.enum(["ANDROID", "IOS"]),
    model: z.string().max(80).nullish(),
    appVersion: z.string().max(40).nullish(),
    attestation: z.string().max(20_000).nullish(),
})

export const challengeSchema = z.object({ purpose: z.enum(["REGISTER", "CHECK_IN"]) })

export const phoneDecisionSchema = z.object({ approve: z.boolean(), reason: z.string().max(500).nullish() })

export const revokePhoneSchema = z.object({ reason: z.string().max(500).nullish() })
