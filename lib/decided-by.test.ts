import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { decidedByName } from "./decided-by"

/**
 * Who decided a task or an obligation is saved as their role's code and
 * their name, "ADMIN Hana Saad". It's said as their name: "By Hana Saad".
 */
describe("who decided it", () => {
    it("is their name, without the role's code saved before it", () => {
        expect(decidedByName("ADMIN Hana Saad")).toBe("Hana Saad")
        expect(decidedByName("SUPER_ADMIN Omar Ali")).toBe("Omar Ali")
        expect(decidedByName("TEAM_LEADER Rania Fahmy")).toBe("Rania Fahmy")
        expect(decidedByName("EMPLOYEE Sami Nabil")).toBe("Sami Nabil")
    })

    it("is left as it is when there's no code before it", () => {
        expect(decidedByName("Hana Said")).toBe("Hana Said")
        expect(decidedByName("Adminah Farouk")).toBe("Adminah Farouk")
    })

    it("is said that way on the Tasks list, the Obligations list and an obligation's page", () => {
        for (const f of ["app/(dashboard)/dashboard/tasks/TasksClient.tsx", "app/(dashboard)/dashboard/obligations/ObligationsClient.tsx", "app/(dashboard)/dashboard/obligations/[id]/client.tsx"]) {
            expect(readFileSync(f, "utf8"), f).toMatch(/t\('list_status_by'\)\.replace\('\{name\}', decidedByName\(/)
        }
    })
})
