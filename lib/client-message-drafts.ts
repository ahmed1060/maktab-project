/**
 * Client messages on WhatsApp (CLIENT_PORTAL_PLAN.md §7.1, §12 step 10b;
 * PR 347): each message's unsaved text, by message and language, with the
 * time of the saved text it started from.
 *
 * A save says that time, so one someone else changed since is refused. It's
 * kept from the text's first change, not read from the page's latest copy of
 * the messages: saving another message reads them all again, and would
 * otherwise let this one replace a newer text unwarned. It moves on only
 * where the page has said so: the save went, or was refused as changed since
 * and the page showed who changed it.
 *
 * The box reads its text once, so it's started again when its version
 * changes: the saved text's while nothing is unsaved, so a newer one read
 * shows at once, and from the first change on the one it was opened from,
 * so typing, a refusal or a save while typing went on never start it again.
 */

export type Edits = {
    /** Each message's unsaved text, by "kind:language"; none where it's as saved. */
    drafts: Record<string, string>
    /** The time of the saved text each started from; null for one never changed. */
    since: Record<string, string | null>
    /** The time of the saved text each one's box was opened from, while it has unsaved text. */
    opened: Record<string, string | null>
}

export const NO_EDITS: Edits = { drafts: {}, since: {}, opened: {} }

function without<T>(kept: Record<string, T>, key: string): Record<string, T> {
    const rest = { ...kept }
    delete rest[key]
    return rest
}

/** A change to a message's text; its time is the saved text's when it's the first. */
export function written(edits: Edits, key: string, text: string, changedAt: string | null): Edits {
    return {
        drafts: { ...edits.drafts, [key]: text },
        since: key in edits.since ? edits.since : { ...edits.since, [key]: changedAt },
        opened: key in edits.opened ? edits.opened : { ...edits.opened, [key]: changedAt },
    }
}

/** The time a save of this message says it started from. */
export function sinceOf(edits: Edits, key: string, changedAt: string | null): string | null {
    return key in edits.since ? edits.since[key] : changedAt
}

/** The box's version: the saved text's while nothing is unsaved, else the one it was opened from. */
export function boxOf(edits: Edits, key: string, changedAt: string | null): string | null {
    return key in edits.opened ? edits.opened[key] : changedAt
}

/**
 * Saved as `sent`, now kept from `changedAt`. A text changed while it was
 * being saved stays unsaved, started from the one just saved.
 */
export function saved(edits: Edits, key: string, sent: string, changedAt: string | null): Edits {
    if (edits.drafts[key] === sent) return discarded(edits, key)
    return { ...edits, since: { ...edits.since, [key]: changedAt } }
}

/** Refused as changed since, the newer one shown: a save after it replaces that one. */
export function conflicted(edits: Edits, key: string, changedAt: string | null): Edits {
    return { ...edits, since: { ...edits.since, [key]: changedAt } }
}

/** Discard changes: the text as saved again. */
export function discarded(edits: Edits, key: string): Edits {
    return { drafts: without(edits.drafts, key), since: without(edits.since, key), opened: without(edits.opened, key) }
}
