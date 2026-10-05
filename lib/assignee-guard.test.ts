import { describe, it, expect } from "vitest"
import { checkAssignees } from "./services/assignee-guard"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * The rule that four places used to decide separately, and decided
 * differently. One of them — the task edit path — decided nothing at all: it
 * checked the task's own company and then wrote whatever assignee ids the
 * request carried, so a task could be handed to another company's user who
 * would see it in their own list.
 */

const CO = "co-1"
const rows: Record<string, any> = {
    "mine-1": { id: "mine-1", companyId: CO, role: "EMPLOYEE", teamLeaderId: "tl-1" },
    "mine-2": { id: "mine-2", companyId: CO, role: "EMPLOYEE", teamLeaderId: "tl-1" },
    "theirs": { id: "theirs", companyId: CO, role: "EMPLOYEE", teamLeaderId: "tl-2" },
    "loose": { id: "loose", companyId: CO, role: "EMPLOYEE", teamLeaderId: null },
    "boss": { id: "boss", companyId: CO, role: "ADMIN", teamLeaderId: null },
    "tl-1": { id: "tl-1", companyId: CO, role: "TEAM_LEADER", teamLeaderId: null },
    "outsider": { id: "outsider", companyId: "co-2", role: "EMPLOYEE", teamLeaderId: null },
}

const client = {
    user: {
        // Deduped, because that is what Postgres does with `id IN (...)`. A
        // mock that returned a row per requested id would make the duplicate
        // test below pass for the wrong reason — and would have hidden the
        // fact that comparing against the raw list length is the bug.
        findMany: async ({ where }: any) =>
            [...new Set<string>(where.id.in)].map(id => rows[id]).filter(Boolean),
    },
}

const leader = { user: withGrants({ id: "tl-1", role: "TEAM_LEADER", companyId: CO }) }
const admin = { user: withGrants({ id: "a-1", role: "ADMIN", companyId: CO }) }
const superAdmin = { user: { id: "sa-1", role: "SUPER_ADMIN", companyId: null } }

const reason = async (ids: string[], session: any) => {
    const v = await checkAssignees(ids, session, "tasks.create", client)
    return v.ok ? null : v.reason
}

describe("a Team Leader assigns within their own team", () => {
    it("accepts their own reports", async () => {
        expect(await reason(["mine-1", "mine-2"], leader)).toBeNull()
    })

    it("accepts themselves, because a leader does their own work too", async () => {
        expect(await reason(["tl-1"], leader)).toBeNull()
    })

    it("refuses another team's employee", async () => {
        expect(await reason(["theirs"], leader)).toBe("OUTSIDE_TEAM")
    })

    it("refuses an employee with no leader", async () => {
        // Unassigned people belong to the Admins. Letting a leader assign them
        // work would be a way of claiming them without an Admin saying so.
        expect(await reason(["loose"], leader)).toBe("OUTSIDE_TEAM")
    })

    it("refuses an Admin, and says so specifically", async () => {
        expect(await reason(["boss"], leader)).toBe("ADMIN_TARGET")
    })

    it("refuses a mixed list containing one outsider", async () => {
        // The failure mode of a per-item check written as `find` on the wrong
        // predicate: most of the list is fine, so it looks fine.
        expect(await reason(["mine-1", "theirs"], leader)).toBe("OUTSIDE_TEAM")
    })
})

describe("company isolation holds for everybody below Super Admin", () => {
    it("refuses another company's user for a leader", async () => {
        expect(await reason(["outsider"], leader)).toBe("CROSS_COMPANY")
    })

    it("refuses another company's user for an admin too", async () => {
        // The bug on the task edit path was exactly this, and an Admin is the
        // role most likely to be editing a task.
        expect(await reason(["outsider"], admin)).toBe("CROSS_COMPANY")
    })

    it("lets an Admin assign anybody inside their company", async () => {
        expect(await reason(["mine-1", "theirs", "loose", "boss"], admin)).toBeNull()
    })

    it("exempts a Super Admin, who belongs to no company", async () => {
        expect(await reason(["outsider"], superAdmin)).toBeNull()
    })
})

describe("the edges", () => {
    it("refuses an id with no row behind it", async () => {
        expect(await reason(["ghost"], admin)).toBe("NOT_FOUND")
    })

    it("is not fooled by a duplicate id padding the list", async () => {
        // Comparing a fetched length against the raw list length lets
        // ["ghost","ghost"] look like two rows when one id matched none.
        expect(await reason(["mine-1", "mine-1"], leader)).toBeNull()
        expect(await reason(["ghost", "ghost"], admin)).toBe("NOT_FOUND")
    })

    it("accepts an empty list rather than refusing it", async () => {
        // Editing a task's title sends no assignees; that is not a refusal.
        expect(await reason([], leader)).toBeNull()
    })
})
