import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { dateTimeText } from "./calendar-text"
import { locationLabel } from "./locations"
import type { BulkRow } from "./bulk-tasks"

/**
 * The bulk review of tasks (DESIGN.md §5.5, "Rows read from a file"), on the
 * building blocks: the file's rows as a list, each with its row's number in
 * the file, a row's mistakes under its title, Edit opening its fields in the
 * dialog, Remove, and the main button saying how many it creates. It was a
 * window of its own making, each title and description changed in a pop-up
 * placed beside it by hand, and its people added and taken off with round
 * plus and minus buttons.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
beforeEach(() => { state.locale = "en" })
afterEach(() => { vi.unstubAllGlobals() })

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const SRC = () => readFileSync("components/BulkTaskReviewModal.tsx", "utf8")
const PAGE = () => readFileSync("app/(dashboard)/dashboard/tasks/new/page.tsx", "utf8")
/** The words a mistake shows: what's wrong, then what the file had, kept apart from the sentence's direction. */
const said = (key: string, detail?: string) => detail === undefined ? words()[key] : `${words()[key]}: \u2068${detail}\u2069`

const NOW = Date.now()
const LATER = new Date(NOW + 5 * 86_400_000).toISOString()
const HOUR = 60 * 60 * 1000
const places = [
    { id: "hq", name: "Nasr City", clientId: "k1", isHq: true, needsPin: false },
    { id: "port", name: "Port gate", clientId: null, isHq: false, needsPin: false },
    { id: "dock", name: "Dock 4", clientId: "k2", isHq: false, needsPin: false },
]
const people = [
    { id: "e1", firstName: "Ehab", lastName: "One", role: "EMPLOYEE" },
    { id: "e2", firstName: "Sara", lastName: "Two", role: "EMPLOYEE" },
]
const clients = [{ id: "k1", name: "Acme" }, { id: "k2", name: "Nile Works" }]
function row(over: Partial<BulkRow> = {}): BulkRow {
    return {
        line: 3, title: "Fix the door", description: "The side door sticks when it rains", clientId: "k1", unknownClient: "",
        locationId: "hq", locationText: "", assigneeIds: ["e1"], unknownPeople: [], deadline: LATER, unreadDeadline: "", difficulty: 2,
        ...over,
    }
}

async function review(rows: BulkRow[], open = true) {
    const { default: BulkTaskReviewModal } = await import("@/components/BulkTaskReviewModal")
    // Its portal is a stand-in's here, which still asks where it goes.
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(BulkTaskReviewModal, {
            isOpen: open, onClose: () => {}, rows, onRowsChange: () => {}, people, onRetryPeople: () => {}, retryingPeople: false, clients, places,
        }))
    } finally {
        vi.unstubAllGlobals()
    }
}
async function fields(r: BulkRow) {
    const { BulkRowFields } = await import("@/components/BulkTaskReviewModal")
    return renderToStaticMarkup(h(BulkRowFields, { row: r, onChange: () => {}, people, onRetryPeople: () => {}, retryingPeople: false, clients, places, now: NOW }))
}
/** A field by its label: the control it names, and what's said under it. */
function field(html: string, label: string): { control: string; note: string } {
    const at = html.indexOf(`>${esc(label)}</label>`)
    expect(at, `no field labelled ${label}`).toBeGreaterThan(-1)
    const id = html.slice(0, at).match(/for="([^"]+)"[^>]*$/)?.[1]
    const control = html.match(new RegExp(`<(input|textarea|select|button)[^>]*id="${id}"[^>]*>`))?.[0] ?? ""
    const noteId = control.match(/aria-describedby="([^"]+)"/)?.[1]
    const note = noteId ? html.match(new RegExp(`id="${noteId}"[^>]*>([^<]*)<`))?.[1] ?? "" : ""
    return { control, note }
}

describe("a row's mistakes", () => {
    it("has none when it's right", async () => {
        const { rowMistakes } = await import("@/lib/bulk-tasks")
        expect(rowMistakes(row(), places, NOW)).toEqual({})
    })

    it("says a title or a description too short or too long, as the server takes them", async () => {
        const { rowMistakes } = await import("@/lib/bulk-tasks")
        expect(rowMistakes(row({ title: "ab" }), places, NOW)).toEqual({ title: { key: "bulk_title_short" } })
        expect(rowMistakes(row({ title: "a".repeat(101) }), places, NOW)).toEqual({ title: { key: "bulk_title_long" } })
        expect(rowMistakes(row({ title: "abc" }), places, NOW)).toEqual({})
        expect(rowMistakes(row({ title: "a".repeat(100) }), places, NOW)).toEqual({})
        expect(rowMistakes(row({ description: "a".repeat(9) }), places, NOW)).toEqual({ description: { key: "bulk_description_short" } })
        expect(rowMistakes(row({ description: "a".repeat(1001) }), places, NOW)).toEqual({ description: { key: "bulk_description_long" } })
        expect(rowMistakes(row({ description: "a".repeat(10) }), places, NOW)).toEqual({})
    })

    // Any change on the old review checked the row again without what the
    // file had named: a username or a client that wasn't found was dropped,
    // and the task created without them, with nothing said.
    it("keeps a username the file had that no one has until the row's people are picked", async () => {
        const { rowMistakes, withPeople, withoutUnknownPeople } = await import("@/lib/bulk-tasks")
        const unknown = row({ unknownPeople: ["ali.h", "sara"] })
        expect(rowMistakes(unknown, places, NOW)).toEqual({ assignees: { key: "bulk_assignees_unknown", detail: "ali.h, sara" } })
        expect(rowMistakes({ ...unknown, title: "Fix the gate" }, places, NOW).assignees?.key).toBe("bulk_assignees_unknown")
        expect(rowMistakes(withPeople(unknown, ["e1", "e2"]), places, NOW)).toEqual({})
        expect(withPeople(unknown, ["e2"]).assigneeIds).toEqual(["e2"])
        expect(rowMistakes(withoutUnknownPeople(unknown), places, NOW)).toEqual({})
        expect(withoutUnknownPeople(unknown).assigneeIds).toEqual(["e1"])
        expect(rowMistakes(row({ assigneeIds: [] }), places, NOW)).toEqual({ assignees: { key: "bulk_assignees_none" } })
        expect(rowMistakes(withPeople(row(), []), places, NOW)).toEqual({ assignees: { key: "bulk_assignees_none" } })
    })

    it("keeps a client the file named that isn't one until a client is picked, No client too", async () => {
        const { rowMistakes, withClient } = await import("@/lib/bulk-tasks")
        const unknown = row({ clientId: null, unknownClient: "Acme Ltd", locationId: "port" })
        expect(rowMistakes(unknown, places, NOW)).toEqual({ client: { key: "bulk_client_unknown", detail: "Acme Ltd" } })
        expect(rowMistakes({ ...unknown, title: "Fix the gate" }, places, NOW).client?.key).toBe("bulk_client_unknown")
        // No client, and the shared location stays.
        const none = withClient(unknown, null, places)
        expect(rowMistakes(none, places, NOW)).toEqual({})
        expect(none.locationId).toBe("port")
        // A client, and its HQ, as picking one on the task form gives.
        expect(withClient(unknown, "k1", places)).toMatchObject({ clientId: "k1", unknownClient: "", locationId: "port" })
        expect(withClient(row({ locationId: "dock", clientId: "k2" }), "k1", places).locationId).toBe("hq")
    })

    it("keeps a deadline the file had that isn't a date until one is picked, and says one too soon as time passes", async () => {
        const { rowMistakes, withDeadline } = await import("@/lib/bulk-tasks")
        const unread = row({ deadline: "", unreadDeadline: "31/02/2026" })
        expect(rowMistakes(unread, places, NOW)).toEqual({ deadline: { key: "bulk_deadline_unread", detail: "31/02/2026" } })
        expect(rowMistakes(withDeadline(unread, LATER), places, NOW)).toEqual({})
        expect(rowMistakes(row({ deadline: "" }), places, NOW)).toEqual({ deadline: { key: "bulk_deadline_none" } })
        expect(rowMistakes(row({ deadline: "soon" }), places, NOW)).toEqual({ deadline: { key: "bulk_deadline_unread", detail: "soon" } })
        expect(rowMistakes(row({ deadline: new Date(NOW + HOUR).toISOString() }), places, NOW)).toEqual({ deadline: { key: "bulk_deadline_soon" } })
        // Fine when the file was read, too soon two hours later.
        const fourHours = row({ deadline: new Date(NOW + 4 * HOUR).toISOString() })
        expect(rowMistakes(fourHours, places, NOW)).toEqual({})
        expect(rowMistakes(fourHours, places, NOW + 2 * HOUR)).toEqual({ deadline: { key: "bulk_deadline_soon" } })
    })

    // The old review checked it, and showed it nowhere: the row was left
    // out with nothing said.
    it("says a difficulty that isn't a whole number from 0 to 10", async () => {
        const { rowMistakes } = await import("@/lib/bulk-tasks")
        for (const difficulty of [11, -1, 1.5, Number.NaN]) {
            expect(rowMistakes(row({ difficulty }), places, NOW), String(difficulty)).toEqual({ difficulty: { key: "bulk_difficulty_range" } })
        }
        for (const difficulty of [0, 10]) expect(rowMistakes(row({ difficulty }), places, NOW)).toEqual({})
    })

    it("says what's wrong with its location, with what the file had while it's still the row's", async () => {
        const { rowMistakes, withLocation, withClient } = await import("@/lib/bulk-tasks")
        expect(rowMistakes(row({ locationId: null, locationText: "Port gaet" }), places, NOW)).toEqual({ location: { key: "bulk_location_not_in_list", detail: "Port gaet" } })
        expect(rowMistakes(row({ locationId: null }), places, NOW)).toEqual({ location: { key: "bulk_location_required" } })
        expect(rowMistakes(row({ locationId: "dock", locationText: "Dock 4" }), places, NOW)).toEqual({ location: { key: "bulk_location_other_client", detail: "Dock 4" } })
        expect(rowMistakes(row({ locationId: "gone", locationText: "Old yard" }), places, NOW)).toEqual({ location: { key: "bulk_location_not_in_list", detail: "Old yard" } })
        const picked = withLocation(row({ locationId: null, locationText: "Port gaet" }), "hq")
        expect(picked).toMatchObject({ locationId: "hq", locationText: "" })
        expect(rowMistakes(picked, places, NOW)).toEqual({})
        // Another client with no HQ: where it's done is to be picked.
        expect(rowMistakes(withClient(row(), "k2", places), places, NOW)).toEqual({ location: { key: "bulk_location_required" } })
    })

    it("lists a row's mistakes in the order its fields are in", async () => {
        const { mistakesInOrder } = await import("@/lib/bulk-tasks")
        expect(mistakesInOrder({ difficulty: { key: "bulk_difficulty_range" }, title: { key: "bulk_title_short" }, location: { key: "bulk_location_required" } }).map(m => m.field))
            .toEqual(["title", "location", "difficulty"])
    })
})

describe("what's sent", () => {
    it("is each row without mistakes, as the server takes a task", async () => {
        const { rowToSend } = await import("@/lib/bulk-tasks")
        expect(rowToSend(row())).toEqual({ title: "Fix the door", description: "The side door sticks when it rains", assigneeIds: ["e1"], deadline: LATER, difficulty: 2, clientId: "k1", locationId: "hq" })
        expect(rowToSend(row({ clientId: null, locationId: "port" })).clientId).toBeUndefined()
    })

    it("says how many the server created, or what it refused", async () => {
        const { createTasks, rowToSend } = await import("@/lib/bulk-tasks")
        const sent: { url: string; init: RequestInit }[] = []
        vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
            sent.push({ url, init })
            return { ok: true, json: async () => ({ success: true, data: { createdCount: 2 } }) } as Response
        })
        expect(await createTasks([rowToSend(row()), rowToSend(row({ line: 4 }))])).toEqual({ created: 2 })
        expect(sent[0].url).toBe("/api/tasks/bulk")
        expect(sent[0].init.method).toBe("POST")
        expect(JSON.parse(String(sent[0].init.body)).tasks).toHaveLength(2)
        vi.stubGlobal("fetch", async () => ({ ok: false, json: async () => ({ success: false, error: "No valid tasks found to create." }) }) as Response)
        expect(await createTasks([rowToSend(row())])).toEqual({ refused: "No valid tasks found to create." })
        vi.stubGlobal("fetch", async () => ({ ok: false, json: async () => { throw new Error("not JSON") } }) as unknown as Response)
        expect(await createTasks([rowToSend(row())])).toEqual({ refused: null })
        vi.stubGlobal("fetch", async () => { throw new Error("offline") })
        expect(await createTasks([rowToSend(row())])).toEqual({ refused: null })
    })
})

describe("the review window", () => {
    it("is the building blocks' dialog, under its name in sentence case", async () => {
        expect(await review([row()], false)).toBe("")
        const html = await review([row()])
        expect(html).toContain(`class="ui-dialog-title">${esc(en.bulk_review_title)}</h2>`)
        expect(en.bulk_review_title).toBe("Review tasks")
        expect(html).toContain('class="ui-bulk-review"')
    })

    it("says how many tasks the file has, and how many have mistakes", async () => {
        expect(await review([row(), row({ line: 4, title: "ab" }), row({ line: 6 })])).toContain(esc("3 tasks read from the file, 1 with mistakes."))
        expect(await review([row(), row({ line: 4 })])).toContain(esc("2 tasks read from the file."))
    })

    it("lists the rows as a table and as cards, each with its row's number in the file", async () => {
        const html = await review([row(), row({ line: 4, title: "Paint the gate" }), row({ line: 7, title: "Check the lights" })])
        expect(html).toContain(`<caption class="ui-visually-hidden">${esc(en.bulk_review_list)}</caption>`)
        expect(html).toMatch(new RegExp(`<th scope="col">${esc(en.bulk_col_row)}</th>`))
        for (const [line, title] of [[3, "Fix the door"], [4, "Paint the gate"], [7, "Check the lights"]] as const) {
            expect(html).toContain(`<tr data-key="${line}">`)
            expect(html).toContain(`<li data-key="${line}">`)
            expect(html).toContain(`>${title}</div>`)
            expect(html).toContain(esc(en.bulk_row.replace("{n}", String(line))))
        }
    })

    it("shows who each is for, its deadline, and where it's done", async () => {
        const html = await review([row({ assigneeIds: ["e1", "e2"] })])
        expect(html).toContain("Ehab One, Sara Two")
        expect(html).toContain(esc(dateTimeText(LATER, "en")!))
        expect(html).toContain(esc(locationLabel("Nasr City", "Acme")))
        expect(await review([row({ assigneeIds: [] })])).toContain(esc(en.bulk_no_one))
        expect(await review([row({ title: "" })])).toContain(esc(en.bulk_no_title))
    })

    it("marks a row with mistakes, and says them under its title", async () => {
        const html = await review([row(), row({ line: 4, title: "ab", difficulty: 11 })])
        expect(html).toContain('<tr data-key="3">')
        expect(html).toContain('<tr data-key="4" data-tone="problem">')
        expect(html).toContain('<li data-key="4" data-tone="problem">')
        const list = html.match(/<ul class="ui-row-mistakes"[^>]*>[\s\S]*?<\/ul>/)?.[0] ?? ""
        expect(list).toContain(`aria-label="${esc(en.bulk_mistakes.replace("{n}", "4"))}"`)
        expect(list).toContain(esc(en.bulk_title_short))
        expect(list).toContain(esc(en.bulk_difficulty_range))
        expect(list.indexOf(esc(en.bulk_title_short))).toBeLessThan(list.indexOf(esc(en.bulk_difficulty_range)))
        // What the file had, kept apart from the sentence's direction.
        expect(await review([row({ unknownPeople: ["ali.h"] })])).toContain(esc(said("bulk_assignees_unknown", "ali.h")))
    })

    it("names each row's Edit and Remove for its row", async () => {
        const html = await review([row({ line: 9 })])
        expect(html).toContain(`aria-label="${esc(en.bulk_edit_row.replace("{n}", "9"))}" data-edit="">${esc(en.edit)}</button>`)
        expect(html).toContain(`aria-label="${esc(en.bulk_remove_row.replace("{n}", "9"))}" data-remove="">${esc(en.remove)}</button>`)
    })

    it("closes with Cancel and creates with the main button, saying how many, and how many are left out", async () => {
        const html = await review([row(), row({ line: 4 }), row({ line: 5, title: "ab" })])
        const actions = html.slice(html.indexOf('class="ui-dialog-actions"'))
        expect(actions).toContain(`<button type="button" class="ui-btn ui-btn-secondary">${esc(en.cancel)}</button>`)
        expect(actions).toContain(`<button type="button" class="ui-btn ui-btn-primary">${esc(en.bulk_create_n.replace("{tasks}", "2 tasks"))}</button>`)
        expect(actions.indexOf(esc(en.cancel))).toBeLessThan(actions.indexOf(esc("Create 2 tasks")))
        expect(html).toContain(esc(en.bulk_left_out.replace("{tasks}", "1 task")))
        // None it can create: off, and saying no number.
        const none = await review([row({ title: "ab" })])
        expect(none).toContain(`<button type="button" class="ui-btn ui-btn-primary" disabled="">${esc(en.create_tasks)}</button>`)
        // Nothing left out, nothing said.
        expect(await review([row()])).not.toContain(esc(en.bulk_left_out.split("{tasks}")[0]))
    })

    it("has nothing of the old window's own making", () => {
        expect(SRC()).not.toMatch(/modal-overlay|modal-content|modal-header|modal-footer|className="btn|className="input|style=\{\{|createPortal|onMouseEnter|editAnchorRect|as any|\|\| '|: any/)
        expect(SRC()).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    })

    it("is in Arabic in Arabic", async () => {
        state.locale = "ar"
        const html = await review([row(), row({ line: 4, title: "ab" }), row({ line: 6 })])
        expect(html).toContain(`class="ui-dialog-title">${esc(ar.bulk_review_title)}</h2>`)
        expect(html).toContain(esc("٣ مهام من الملف، في ١ منها أخطاء."))
        expect(html).toContain(esc(ar.bulk_row.replace("{n}", "٤")))
        expect(html).toContain(esc(ar.bulk_create_n.replace("{tasks}", "مهمتان")))
    })
})

describe("a row's fields", () => {
    it("are the form's, in its order, each with its label", async () => {
        const html = await fields(row())
        const labels = [en.title_label, en.description_label, en.location_client, en.task_location, en.assignees_label, en.deadline_label, en.difficulty]
        const at = labels.map(label => html.indexOf(`>${esc(label)}</`))
        for (const [i, label] of labels.entries()) expect(at[i], label).toBeGreaterThan(-1)
        expect([...at].sort((a, b) => a - b)).toEqual(at)
        expect(field(html, en.title_label).control).toMatch(/^<input[^>]*value="Fix the door"/)
        expect(html).toContain(esc(en.ui_characters_used.replace("{used}", "12").replace("{max}", "100")))
        expect(field(html, en.description_label).control).toMatch(/^<textarea/)
        expect(field(html, en.difficulty).control).toMatch(/type="number"[^>]*min="0" max="10"[^>]*value="2"/)
    })

    it("says what's wrong under each field, tied to it, for a screen reader to read with it", async () => {
        const title = field(await fields(row({ title: "ab" })), en.title_label)
        expect(title.control).toContain('aria-invalid="true"')
        expect(title.note).toBe(esc(en.bulk_title_short))
        const place = field(await fields(row({ locationId: null, locationText: "Port gaet" })), en.task_location)
        expect(place.control).toContain('aria-invalid="true"')
        expect(place.note).toBe(esc(said("bulk_location_not_in_list", "Port gaet")))
        const difficulty = field(await fields(row({ difficulty: 11 })), en.difficulty)
        expect(difficulty.control).toContain('value="11"')
        expect(difficulty.note).toBe(esc(en.bulk_difficulty_range))
    })

    it("names its selects for what they hold", async () => {
        const html = await fields(row())
        expect(field(html, en.location_client).control).toContain('name="clientId"')
        expect(field(html, en.task_location).control).toContain('name="locationId"')
    })

    it("shows a client the file named that isn't one as not found, until one is picked", async () => {
        const html = await fields(row({ clientId: null, unknownClient: "Acme Ltd", locationId: "port" }))
        const client = field(html, en.location_client)
        expect(client.note).toBe(esc(said("bulk_client_unknown", "Acme Ltd")))
        expect(html).toContain(`<option value="?" disabled="" selected="">${esc(en.bulk_client_not_found.replace("{text}", "\u2068Acme Ltd\u2069"))}</option>`)
        expect(html).toContain(`<option value="">${esc(en.task_no_client)}</option>`)
    })

    it("offers to leave out the usernames the file had that no one has", async () => {
        const html = await fields(row({ unknownPeople: ["ali.h"] }))
        expect(html).toContain(esc(said("bulk_assignees_unknown", "ali.h")))
        expect(html).toContain(`<button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">${esc(en.bulk_ignore_usernames)}</button>`)
        expect(await fields(row())).not.toContain(esc(en.bulk_ignore_usernames))
    })

    it("has its client and location spaced with the design's tokens (DESIGN.md §10)", async () => {
        const html = await fields(row())
        expect(html).toMatch(/<div class="ui-field-group">/)
        expect(html).not.toMatch(/style="/)
    })
})

describe("going between the list and a row", () => {
    it("goes back to the list on Done or Escape, to that row, and does nothing on Escape while they're sent", () => {
        const src = SRC()
        expect(src).toContain("onClose={sending ? ignore : editing !== null ? back : onClose}")
        expect(src).toContain("<Button variant=\"primary\" onClick={back}>{t('done')}</Button>")
        // The row's Edit takes the focus again, in the view that's showing.
        expect(src).toContain("visibleRow(String(want.line))?.querySelector<HTMLElement>(`[data-${want.button}]`)?.focus()")
    })

    it("closes once the last row is removed", () => {
        expect(SRC()).toContain("if (rest.length === 0) return onClose()")
    })

    // Remove doesn't ask, as nothing is saved yet, but it can be undone:
    // the old window's Delete couldn't (Vercel's web interface audit).
    it("says which row was removed, with Undo to put it back where it was", async () => {
        const { withRowBack } = await import("@/lib/bulk-tasks")
        const rows = [row({ line: 3 }), row({ line: 5 })]
        expect(withRowBack(rows, { row: row({ line: 4 }), at: 1 }).map(r => r.line)).toEqual([3, 4, 5])
        expect(withRowBack(rows, { row: row({ line: 9 }), at: 7 }).map(r => r.line)).toEqual([3, 5, 9])
        const src = SRC()
        expect(src).toContain("<p className=\"ui-bulk-status\" role=\"status\">")
        expect(src).toContain("t('bulk_removed').replace('{n}', num(removed.row.line))")
        expect(src).toContain("<Button size=\"sm\" variant=\"quiet\" disabled={sending} onClick={undo}>{t('bulk_undo')}</Button>")
    })

    // Codex review of PR 212: a row put back while the tasks were sent
    // wasn't among them, and the dialog closed without it.
    it("keeps the rows as they are while they're sent: Undo is off, as Edit and Remove are", () => {
        const src = SRC()
        expect(src).toContain("if (!removed || sending) return")
        for (const button of ["data-edit=\"\" disabled={sending}", "data-remove=\"\" disabled={sending}", "variant=\"quiet\" disabled={sending} onClick={undo}"]) expect(src, button).toContain(button)
    })

    it("asks before the page is left with the file's rows still to create", () => {
        const src = SRC()
        expect(src).toContain("if (!isOpen || sending) return")
        expect(src).toContain("window.addEventListener('beforeunload', warn)")
    })

    it("says what the server refused above the buttons, and keeps the dialog open", () => {
        const src = SRC()
        expect(src).toContain("{refused !== undefined && <p className=\"ui-error\" role=\"alert\">{refused ?? t('bulk_create_failed')}</p>}")
        expect(src).toContain("disabled={sending}")
        expect(src).toContain("busy={sending}")
    })
})

describe("Create task", () => {
    it("reads each row as the review has it, with what the file had that wasn't found", () => {
        const page = PAGE()
        for (const kept of ["unknownPeople", "unknownClient", "locationText", "unreadDeadline", "line:"]) expect(page, kept).toContain(kept)
        for (const gone of ["revalidateRow", "validationErrors", "isInvalid", "resolvedNames", "|| 'Missing assignees'"]) expect(page, gone).not.toContain(gone)
    })

    it("hands the review the people the form picks from", () => {
        const page = PAGE()
        const review = page.slice(page.indexOf("<BulkTaskReviewModal"), page.indexOf("/>", page.indexOf("<BulkTaskReviewModal")))
        expect(review).toContain("people={usersError ? null : usersResult ? users : undefined}")
        expect(review).toContain("onRowsChange={setBulkTasks}")
    })
})

describe("its words", () => {
    const KEYS = ["bulk_review_title", "bulk_review_list", "bulk_review_read", "bulk_review_read_mistakes", "bulk_left_out", "bulk_col_row", "bulk_row",
        "bulk_edit_row", "bulk_remove_row", "bulk_edit_title", "bulk_no_title", "bulk_no_one", "bulk_none_yet", "bulk_mistakes", "bulk_create_n", "create_tasks",
        "bulk_created", "bulk_created_some", "bulk_create_failed", "bulk_removed", "bulk_undo", "bulk_title_short", "bulk_title_long", "bulk_description_short",
        "bulk_description_long", "bulk_client_unknown", "bulk_client_not_found", "bulk_assignees_none", "bulk_assignees_unknown",
        "bulk_ignore_usernames", "bulk_deadline_none", "bulk_deadline_unread", "bulk_deadline_soon", "bulk_difficulty_range",
        "bulk_location_required", "bulk_location_not_in_list", "bulk_location_other_client", "bulk_location_needs_pin", "bulk_location_hint",
        "task_location_choose"] as const

    it("are in both languages, in sentence case, and the Arabic commands nothing in the masculine", () => {
        for (const key of KEYS) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(en[key], key).not.toMatch(/\b(Review Tasks|Create Tasks|Missing Title|Invalid Username|Rows with errors)\b/)
            expect(ar[key], key).not.toMatch(/(^|\s)(اختر|ارفع|حمّل|حمل|أدخل|حدد)(\s|$)/)
        }
        for (const key of ["bulk_review_read", "bulk_review_read_mistakes", "bulk_left_out", "bulk_create_n", "bulk_created"] as const) {
            expect(en[key], key).toContain("{tasks}")
            expect(ar[key], key).toContain("{tasks}")
        }
        // What the file had is said after the words, never inside them.
        for (const key of ["bulk_client_unknown", "bulk_assignees_unknown", "bulk_deadline_unread", "bulk_location_not_in_list"] as const) {
            expect(en[key], key).not.toContain("{")
            expect(ar[key], key).not.toContain("{")
        }
    })

    it("no longer keep the old window's own", () => {
        for (const key of ["rows_with_errors", "skipped_status", "missing_title", "add_assignee", "remove_assignee", "delete_row", "all_users_added",
            "invalid_username", "bulk_create_success", "invalid_client_name", "missing_deadline", "title_too_short", "title_too_long", "desc_too_short",
            "desc_too_long", "invalid_difficulty"]) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })
})
