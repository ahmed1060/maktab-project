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

export const challengeSchema = z.object({ purpose: z.enum(["REGISTER", "CHECK_IN", "FACE"]) })

export const phoneDecisionSchema = z.object({ approve: z.boolean(), reason: z.string().max(500).nullish() })

export const revokePhoneSchema = z.object({ reason: z.string().max(500).nullish() })

/** A check-in as the app sends it (§9.4). The service checks the signature, the number and the fix. */
export const checkInSchema = z.object({
    nonce: z.string().min(20).max(100),
    keyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().min(1).max(256),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracyMeters: z.number().finite().min(0).max(100_000),
    mocked: z.boolean(),
    direction: z.enum(["IN", "OUT"]).nullish(),
    attestation: z.string().max(20_000).nullish(),
    /** The face check's result, when face verification is asked of the person (§9.5). */
    face: z.object({
        verified: z.boolean(),
        score: z.number().finite().min(0).max(1),
        liveness: z.number().finite().min(0).max(1),
        modelVersion: z.string().min(1).max(60),
        attempts: z.number().int().min(1).max(10),
        frameSha256: z.string().regex(/^[0-9a-f]{64}$/).nullish(),
    }).nullish(),
    /** The last frame of a failed face check, JPEG base64 (§13.8). */
    faceFrame: z.string().max(560_000).nullish(),
})
