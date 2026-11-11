import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import type { ActionStart } from "./useBusyAction"

/**
 * A button that changes data shows it is working and can't be clicked again
 * meanwhile. Before, 59 of them had no busy state at all: nothing changed on
 * screen until the answer came, and a second click sent the request again
 * (approving a day off twice gave "success" and then an error).
 */

// Just enough of React's state for the hook's own logic: one component, one render.
const state: unknown[] = []
let slot = 0
// What an ActionStarts around the component says, if there's one.
const around: { told: ActionStart | null } = { told: null }
vi.mock("react", () => ({
    useState: (initial: unknown) => {
        const i = slot++
        if (!(i in state)) state[i] = initial
        return [state[i], (v: unknown) => { state[i] = v }]
    },
    useRef: (initial: unknown) => ({ current: initial }),
    useCallback: (fn: unknown) => fn,
    createContext: (initial: unknown) => ({ initial }),
    useContext: () => around.told,
}))
const { useBusyAction } = await import("./useBusyAction")
// One render of a component that calls the hook (React itself is stood in for above).
// eslint-disable-next-line react-hooks/rules-of-hooks
const render = (onStart?: ActionStart) => { slot = 0; return useBusyAction(onStart) }
/** An ActionStart that writes down what it hears, as `name`. */
const saying = (said: string[], name: string): ActionStart => () => { said.push(name); return () => { said.push(`${name} answered`) } }

describe("useBusyAction", () => {
    it("runs one action at a time and says which", async () => {
        const action = render()
        let finish!: () => void
        const work = vi.fn(() => new Promise<void>(r => { finish = r }))

        const first = action.run("approve", work)
        expect(render().running).toBe(true)
        expect(render().is("approve")).toBe(true)
        expect(render().is("reject")).toBeUndefined()

        // A second click, before the first answer: ignored, not sent again.
        await action.run("approve", work)
        await action.run("reject", work)
        expect(work).toHaveBeenCalledTimes(1)

        finish()
        await first
        expect(render().running).toBe(false)
        expect(render().is("approve")).toBeUndefined()
    })

    it("is free again after a failure", async () => {
        const action = render()
        await expect(action.run("save", async () => { throw new Error("refused") })).rejects.toThrow("refused")
        expect(render().running).toBe(false)
        const again = vi.fn(async () => "ok")
        expect(await action.run("save", again)).toBe("ok")
    })
    // So a list that shows what someone else changed takes the next draw as
    // the person's own, though their change's live signal comes before the
    // answer (components/useArrivals.ts; found by Codex on PR 251).
    it("says it's starting before it sends anything, once for each action it runs", async () => {
        const said: string[] = []
        const action = render(saying(said, "starts"))
        let finish!: () => void
        const first = action.run("approve", () => { said.push("sends"); return new Promise<void>(r => { finish = r }) })
        expect(said).toEqual(["starts", "sends"])
        // A second click, ignored, says nothing.
        await action.run("approve", async () => { said.push("sends again") })
        expect(said).toEqual(["starts", "sends"])
        finish()
        await first
        expect(said).toEqual(["starts", "sends", "starts answered"])
    })

    // So what's drawn while it's on its way stays the person's own, however
    // long a two-factor code asked for on the way takes (PR 252).
    it("says once it's answered, and only then, saved or refused", async () => {
        const said: string[] = []
        const action = render(saying(said, "starts"))
        let finish!: () => void
        const first = action.run("give", () => new Promise<void>(r => { finish = r }))
        expect(said).toEqual(["starts"])
        finish()
        await first
        expect(said).toEqual(["starts", "starts answered"])
        await expect(render(saying(said, "again")).run("give", async () => { throw new Error("refused") })).rejects.toThrow("refused")
        expect(said).toEqual(["starts", "starts answered", "again", "again answered"])
    })

    it("hears it from an ActionStarts around it, as a dialog's does, unless it's given its own", async () => {
        const said: string[] = []
        around.told = saying(said, "around")
        try {
            await render().run("ask", async () => {})
            await render(saying(said, "own")).run("ask", async () => {})
        } finally {
            around.told = null
        }
        expect(said).toEqual(["around", "around answered", "own", "own answered"])
        // And nothing to say it to, on any other screen.
        await render().run("save", async () => {})
        expect(said).toEqual(["around", "around answered", "own", "own answered"])
    })
})

describe("data buttons that had no busy state", () => {
    const uses: [string, RegExp][] = [
        // Approving and rejecting a day off, on the Requests page (UI_PLAN.md §2.3, part 2d).
        ["app/(dashboard)/dashboard/requests/DayOffDialogs.tsx", /action\.run\('decide'[\s\S]*?busy=\{action\.is\('decide'\)\}/],
        ["app/(dashboard)/dashboard/obligations/[id]/client.tsx", /action\.run\('approve', handleApprove\)/],
        ["app/(dashboard)/dashboard/obligations/[id]/client.tsx", /action\.run\('reject', handleReject\)/],
        ["app/(dashboard)/dashboard/obligations/[id]/client.tsx", /action\.run\('delete', handleDelete\)/],
        ["app/(dashboard)/dashboard/obligations/[id]/client.tsx", /action\.run\('reassign', handleReassign\)/],
        ["app/(dashboard)/dashboard/obligations/[id]/client.tsx", /action\.run\('complete', handleForceComplete\)/],
        // Mark as paid asks first now, and its dialog's button is busy until it's done (the Super Admin's pages part 3b).
        ["app/(dashboard)/dashboard/companies/[id]/payments/page.tsx", /<MarkPaidDialog[^\n]*busy=\{busy\}/],
        ["app/(dashboard)/dashboard/tasks/[id]/client.tsx", /action\.run\('dismiss', handleDismiss\)/],
        ["app/(dashboard)/dashboard/attendance/NumbersTab.tsx", /action\.run\(`map-\$\{u\.code\}`/],
        ["components/AccessReviews.tsx", /action\.run\(`confirm-\$\{line\.id\}`/],
        ["components/RoleChangeRequests.tsx", /action\.run\(`done-\$\{r\.id\}`/],
        ["components/CompanyRolesCard.tsx", /action\.run\(`default-\$\{role\.id\}`/],
        ["components/TaskConfirmModals.tsx", /action\.run\('item', onConfirmDeleteItem\)/],
        ["components/TaskEditDetailsModal.tsx", /action\.run\('save'/],
        ["components/DashboardHeader.tsx", /action\.run\('logout', handleLogout\)/],
    ]
    it.each(uses)("%s shows it working", (file, pattern) => {
        expect(stripComments(readFileSync(file, "utf8"))).toMatch(pattern)
    })
})
