import { describe, it, expect } from "vitest"
import { NO_EDITS, boxOf, conflicted, discarded, saved, sinceOf, written } from "./client-message-drafts"

/**
 * Client messages on WhatsApp (CLIENT_PORTAL_PLAN.md §7.1, §12 step 10b;
 * PR 347): each message's unsaved text, by message and language, kept with
 * the time of the saved text it started from. A save says that time, so one
 * someone else changed since is refused, whatever the page has read since.
 */

const T1 = "2026-11-20T10:00:00.000Z", T2 = "2026-11-20T11:00:00.000Z", T3 = "2026-11-20T12:00:00.000Z"

describe("a message's unsaved text", () => {
    it("keeps the time of the text it started from, from its first change on", () => {
        let edits = written(NO_EDITS, "contact:en", "a", T1)
        edits = written(edits, "contact:en", "ab", T2)
        expect(edits.drafts).toEqual({ "contact:en": "ab" })
        expect(sinceOf(edits, "contact:en", T2)).toBe(T1)
    })

    it("one never changed started from none", () => {
        const edits = written(NO_EDITS, "claim:ar", "x", null)
        expect(sinceOf(edits, "claim:ar", T3)).toBeNull()
    })

    it("each message in each language its own", () => {
        const edits = written(written(NO_EDITS, "contact:en", "a", T1), "claim:en", "b", T2)
        expect(sinceOf(edits, "contact:en", T3)).toBe(T1)
        expect(sinceOf(edits, "claim:en", T3)).toBe(T2)
    })

    it("with none, the time the page has", () => {
        expect(sinceOf(NO_EDITS, "contact:en", T3)).toBe(T3)
    })
})

describe("saved", () => {
    it("as it was sent: no unsaved text left", () => {
        const edits = saved(written(NO_EDITS, "contact:en", "a", T1), "contact:en", "a", T2)
        expect(edits).toEqual(NO_EDITS)
    })

    it("changed while it was being saved: the newer text kept, from the save's time", () => {
        const edits = saved(written(written(NO_EDITS, "contact:en", "a", T1), "contact:en", "ab", T1), "contact:en", "a", T2)
        expect(edits.drafts).toEqual({ "contact:en": "ab" })
        expect(sinceOf(edits, "contact:en", T3)).toBe(T2)
    })

    it("another message's left as it was", () => {
        let edits = written(written(NO_EDITS, "contact:en", "a", T1), "claim:en", "b", T1)
        edits = saved(edits, "claim:en", "b", T2)
        expect(edits.drafts).toEqual({ "contact:en": "a" })
        expect(sinceOf(edits, "contact:en", T3)).toBe(T1)
    })
})

describe("refused as changed since", () => {
    it("keeps the text, and a save after it replaces the newer one", () => {
        const edits = conflicted(written(NO_EDITS, "contact:en", "a", T1), "contact:en", T2)
        expect(edits.drafts).toEqual({ "contact:en": "a" })
        expect(sinceOf(edits, "contact:en", T3)).toBe(T2)
    })
})

describe("discarded", () => {
    it("the text and its time both gone", () => {
        let edits = written(written(NO_EDITS, "contact:en", "a", T1), "claim:en", "b", T1)
        edits = discarded(edits, "contact:en")
        expect(edits.drafts).toEqual({ "claim:en": "b" })
        expect(sinceOf(edits, "contact:en", T3)).toBe(T3)
    })
})

describe("the box's version, which starts it again when it changes", () => {
    // PR 347, Codex's third finding: the box reads its text once, so a saved text read again must start it again.
    it("with nothing unsaved, the saved text's: a newer one read starts the box again", () => {
        expect(boxOf(NO_EDITS, "contact:en", T1)).toBe(T1)
        expect(boxOf(NO_EDITS, "contact:en", T2)).toBe(T2)
        expect(boxOf(NO_EDITS, "contact:en", null)).toBeNull()
    })

    it("from the first change on, the one it was opened from, so typing never starts it again", () => {
        const edits = written(NO_EDITS, "contact:en", "a", T1)
        expect(boxOf(edits, "contact:en", T1)).toBe(T1)
        expect(boxOf(edits, "contact:en", T2)).toBe(T1)
        // Typing on after a newer saved text was read.
        expect(boxOf(written(edits, "contact:en", "ab", T2), "contact:en", T2)).toBe(T1)
    })

    it("refused as changed since, or saved while typing went on, the same: the unsaved text stays in it", () => {
        const opened = written(NO_EDITS, "contact:en", "a", T1)
        expect(boxOf(conflicted(opened, "contact:en", T2), "contact:en", T2)).toBe(T1)
        const typed = written(opened, "contact:en", "ab", T1)
        expect(boxOf(saved(typed, "contact:en", "a", T2), "contact:en", T2)).toBe(T1)
    })

    it("saved as sent, or discarded, the saved text's again", () => {
        expect(boxOf(saved(written(NO_EDITS, "contact:en", "a", T1), "contact:en", "a", T2), "contact:en", T2)).toBe(T2)
        expect(boxOf(discarded(written(NO_EDITS, "contact:en", "a", T1), "contact:en"), "contact:en", T3)).toBe(T3)
    })
})

describe("a box's version other than the saved text's time (PR 349)", () => {
    it("Nizmo's text read anew while a company uses it starts the box again; from the first change on, it's the one opened", () => {
        // A company using Nizmo's has no time of its own that changes when the Super Admin changes Nizmo's.
        expect(boxOf(NO_EDITS, "contact:en", "never|Hello")).toBe("never|Hello")
        expect(boxOf(NO_EDITS, "contact:en", "never|Hello again")).toBe("never|Hello again")
        const edits = written(NO_EDITS, "contact:en", "Hi", null, "never|Hello")
        expect(boxOf(edits, "contact:en", "never|Hello again")).toBe("never|Hello")
        // The time a save says is still the saved text's.
        expect(sinceOf(edits, "contact:en", T1)).toBeNull()
    })
})
