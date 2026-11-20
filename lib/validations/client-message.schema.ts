import { z } from "zod"
import { MESSAGE_KINDS, MESSAGE_LANGUAGES } from "@/lib/client-message-template"

/**
 * Saving one of Nizmo's client messages (CLIENT_PORTAL_PLAN.md §7.1, step
 * 10b), or a company's copy of one (step 10c-1, PR 348): which message and
 * language, from the address; its text; and when
 * the page read it last changed, none if never. What the text may say is
 * checked by the service (messageProblem), the length so a page can say it;
 * this only keeps far longer bodies out.
 */
export const clientMessageSchema = z.object({
    kind: z.enum(MESSAGE_KINDS),
    language: z.enum(MESSAGE_LANGUAGES),
    text: z.string().max(20_000),
    since: z.string().datetime().nullable(),
})

/**
 * A company going back to Nizmo's message (§7.1, step 10c-1; PR 348):
 * which message and language, from the address, and the time of the
 * company's copy the page read, none where it read Nizmo's.
 */
export const nizmoMessageAgainSchema = z.object({
    kind: z.enum(MESSAGE_KINDS),
    language: z.enum(MESSAGE_LANGUAGES),
    since: z.string().datetime().nullable(),
})
