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

/**
 * Use Nizmo's message for every language a company changed at once (§7.1,
 * step 10c-2; PR 349): which message, from the address, and for each
 * language the time of the company's message the tab read, none where it
 * never changed it. Each is said, so a language the tab didn't read can't
 * be put back unseen.
 */
export const nizmoMessagesAgainSchema = z.object({
    kind: z.enum(MESSAGE_KINDS),
    since: z.object({
        ar: z.string().datetime().nullable(),
        en: z.string().datetime().nullable(),
    }),
})
