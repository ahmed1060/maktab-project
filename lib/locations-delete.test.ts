import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { locationActions } from "@/lib/locations"
import { KNOWN_REFUSALS } from "@/lib/api-errors"
import { AUDIT_ACTIONS } from "@/lib/audit-codes"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * Deleting a location no task has used (LATER_CHANGES_PLAN.md §7.21;
 * DESIGN.md §5.5, Row menu): when the row menu offers it, the route, the
 * list's dialog and what it says, and the words in both languages. What the
 * server does is lib/locations-delete.db.test.ts's.
 */

const read = (file: string) => stripComments(readFileSync(file, "utf8"))

describe("the row menu", () => {
    const branch = { archivedAt: null, isHq: false, client: { id: "v-1" }, inUse: false }
    const both = { edit: true, archive: true }

    it("offers Delete last, after Archive, for one no task has used, with locations.archive", () => {
        expect(locationActions(branch, both)).toEqual(["edit", "hq", "archive", "delete"])
        expect(locationActions({ ...branch, client: null }, both)).toEqual(["edit", "archive", "delete"])
        expect(locationActions(branch, { edit: false, archive: true })).toEqual(["archive", "delete"])
        expect(locationActions(branch, { edit: true, archive: false })).toEqual(["edit", "hq"])
    })

    it("offers it after Restore once archived", () => {
        const archived = { ...branch, archivedAt: "2026-11-01" }
        expect(locationActions(archived, both)).toEqual(["restore", "delete"])
        expect(locationActions({ ...archived, inUse: true }, both)).toEqual(["restore"])
        expect(locationActions(archived, { edit: true, archive: false })).toEqual([])
    })

    it("never offers it for one a task has used, one not known to be unused, or a client's HQ", () => {
        expect(locationActions({ ...branch, inUse: true }, both)).toEqual(["edit", "hq", "archive"])
        const { inUse: _unknown, ...unknown } = branch
        expect(locationActions(unknown, both)).toEqual(["edit", "hq", "archive"])
        expect(locationActions({ ...branch, isHq: true }, both)).toEqual(["edit"])
    })
})

describe("the route", () => {
    const route = read("app/api/locations/route.ts")

    it("deletes the one named, for whoever may archive locations", () => {
        const del = route.slice(route.indexOf("export const DELETE"))
        expect(del).toContain('const id = new URL(req.url).searchParams.get("id")')
        expect(del).toContain('if (!id) return ApiResponse.badRequest("ID required")')
        expect(del).toContain("await LocationService.delete(session, id)")
        expect(del).toContain('{ permission: "locations.archive" }')
    })

    it("has its refusal said, as a conflict", () => {
        expect(KNOWN_REFUSALS.TASK_LOCATION_IN_USE).toEqual({ status: 409, message: "A task uses this location now, so it can't be deleted. It can be archived instead." })
    })
})

describe("the list", () => {
    const list = read("components/locations/LocationsList.tsx")

    it("has Delete in the danger colour, asking first", () => {
        expect(list).toContain("delete: { key: 'delete', label: t('locations_delete'), icon: TrashIcon, danger: true, onSelect: () => setToDelete(l) }")
        const dialog = list.slice(list.indexOf("open={!!toDelete}"))
        expect(dialog).toMatch(/^open=\{!!toDelete\}\s+title=\{t\('locations_delete'\)\}\s+body=\{t\('locations_delete_question'\)\.replace\('\{name\}', toDelete \? locationLabel\(toDelete\.name, toDelete\.client\?\.name\) : ''\)\}\s+confirmLabel=\{t\('locations_delete'\)\}\s+danger\s+onConfirm=\{confirmDelete\}/)
    })

    it("deletes the one asked, says so, and reads the list again", () => {
        expect(list).toContain("fetch(`/api/locations?id=${encodeURIComponent(l.id)}`, { method: 'DELETE' })")
        expect(list).toContain("showToast(t('locations_deleted'), 'success')")
    })

    it("says in the page's language why one a task took meanwhile is kept, and reads the list again so it's offered no more", () => {
        expect(list).toContain("answer?.code === 'TASK_LOCATION_IN_USE' ? t('locations_delete_in_use') : answer?.error || t('error_generic')")
        expect(list).toMatch(/if \(!res\.ok\) \{\s+showToast\(answer\?\.code === 'TASK_LOCATION_IN_USE'[^\n]+\n\s+if \(answer\?\.code === 'TASK_LOCATION_IN_USE'\) changed\(\)\n\s+return/)
    })

    it("closes the question once another company is picked, as the others are", () => {
        expect(list).toContain("useAdjustOnChange([scope], () => { setEditing(null); setToArchive(null); setToDelete(null); onAddingChange?.(false) })")
    })
})

describe("the words", () => {
    it("are in both languages, the Arabic gender-neutral", () => {
        expect(en.locations_delete).toBe("Delete")
        expect(en.locations_delete_question).toBe("Delete {name}? No task has used it. This can't be undone.")
        expect(en.locations_deleted).toBe("Location deleted")
        expect(en.locations_delete_in_use).toBe(KNOWN_REFUSALS.TASK_LOCATION_IN_USE.message)
        expect(ar.locations_delete).toBe("حذف")
        expect(ar.locations_delete_question).toBe("حذف {name}؟ لم تستخدمه أي مهمة، ولا يمكن التراجع عن الحذف.")
        expect(ar.locations_deleted).toBe("تم حذف الموقع")
        expect(ar.locations_delete_in_use).toBe("تستخدم مهمة هذا الموقع الآن، لذا لا يمكن حذفه. يمكن أرشفته بدلًا من ذلك.")
    })

    it("name what locations.archive does now, and the audit log's line", () => {
        expect(en.perm_locations_archive).toBe("Archive, restore and delete locations")
        expect(ar.perm_locations_archive).toBe("أرشفة المواقع واستعادتها وحذفها")
        expect(AUDIT_ACTIONS).toContain("DELETE_LOCATION")
        expect(en.audit_action_DELETE_LOCATION).toBe("Deleted location")
        expect(ar.audit_action_DELETE_LOCATION).toBe("تم حذف موقع")
    })
})
