import { describe, it, expect, vi } from "vitest"

/**
 * The section boundary that replaced three try/catch-around-JSX blocks.
 *
 * There is no DOM in this suite, so this does not mount anything. What it
 * checks is the part that is ours: the boundary's own decisions, and that each
 * section really is inside one. React delivering a render error to the nearest
 * boundary is React's guarantee, not something to re-prove here.
 */

const reported: any[] = []
vi.mock("@/lib/client-error-report", () => ({
    reportClientError: async (...args: any[]) => { reported.push(args); return null },
}))

describe("the boundary", () => {
    it("marks itself failed on any error", async () => {
        const { default: SectionBoundary } = await import("@/components/SectionBoundary")
        expect(SectionBoundary.getDerivedStateFromError()).toEqual({ failed: true })
    })

    it("renders nothing once failed, and its children until then", async () => {
        const { default: SectionBoundary } = await import("@/components/SectionBoundary")
        const b = new SectionBoundary({ name: "x", children: "child" })
        expect(b.render()).toBe("child")
        b.state = { failed: true }
        // Nothing, rather than a panel: a malformed task log should cost that
        // one section, the way the old catch { return null } did.
        expect(b.render()).toBeNull()
    })

    it("reports what it caught, which the old catch never did", async () => {
        const { default: SectionBoundary } = await import("@/components/SectionBoundary")
        reported.length = 0
        const b = new SectionBoundary({ name: "TaskCostsSection", children: null })
        b.componentDidCatch(new Error("bad log"), { componentStack: "at X" } as any)
        expect(reported).toHaveLength(1)
        expect(reported[0][1]).toBe("section:TaskCostsSection")
    })
})

describe("each section is inside one", () => {
    // Calling the exported component returns the element it renders, without
    // running any hooks — the wrapper has none. That makes the wiring
    // checkable without a DOM.
    const cases = [
        ["@/components/TaskCostsSection", "TaskCostsSection"],
        ["@/components/TaskLocationHistorySection", "TaskLocationHistorySection"],
    ] as const

    for (const [path, name] of cases) {
        it(`${name} renders its body inside SectionBoundary`, async () => {
            const { default: SectionBoundary } = await import("@/components/SectionBoundary")
            const mod = await import(path)
            const element = mod.default({ task: {} } as any)
            expect(element.type).toBe(SectionBoundary)
            expect(element.props.name).toBe(name)
            expect(element.props.children.type.name).toBe(`${name}Body`)
        })
    }
})
