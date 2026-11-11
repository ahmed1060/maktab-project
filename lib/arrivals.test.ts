import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import {
    ARRIVAL_MS, EXPECT_MS, actionAnswered, actionStarts, afterDraw, arrivedBetween, arrivedOnDraw, drawn, expectNext, forgets, mark, rose, unmark,
    type Expecting, type Marks,
} from "./arrivals"

/**
 * Live updates, part 5 (REALTIME_PLAN.md; DESIGN.md §8; PR 251).
 *
 * Since parts 1 and 2, a task or a request someone else adds or changes
 * appears in the open list within a second or two, and the bell's count
 * changes, with nothing to say where. Now a row that arrives or changes
 * takes the brand tint, which holds for half a second and fades back to the
 * row's own colour within 2 seconds, and the bell's count grows a little as
 * it rises. Only for what someone else did: not for the person's own
 * changes, not as a page opens, and not when they look at another tab,
 * filter or page. A row that goes simply goes. With "reduce motion" the tint
 * shows for its 2 seconds and goes without fading, and the count doesn't
 * grow.
 *
 * The suite has no browser, so the hook's decisions are pure functions,
 * walked through below as components/useArrivals.ts calls them, and its
 * source is checked to call them so.
 */

vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))

type Row = { id: string; title: string; status: string }
const key = (r: Row) => r.id
const A: Row = { id: "a", title: "Fix the gate", status: "PENDING" }
const B: Row = { id: "b", title: "Paint the hall", status: "IN_PROGRESS" }
const C: Row = { id: "c", title: "Clean the roof", status: "PENDING" }
const LIST = "/dashboard/tasks?"
const at = (rows: Row[], scope = LIST) => drawn(scope, rows, key)

/**
 * A list as useArrivals keeps it: the draw before, what the next draw
 * follows, and the keys a draw marks. A draw that changes nothing is no
 * draw (useAdjustOnChange runs only on a change).
 */
function list(rows: Row[]) {
    let before = at(rows)
    let expecting: Expecting = null
    return {
        signal: () => { expecting = expectNext(expecting, "live") },
        /** The person's own action starting; what it returns, its answer. */
        start: () => {
            expecting = actionStarts(expecting)
            return () => { expecting = actionAnswered(expecting) }
        },
        /** An action of their own that's answered at once. */
        own() { this.start()() },
        /** EXPECT_MS gone by, if anything is forgotten then. */
        forget: () => { if (forgets(expecting)) expecting = null },
        draw(now: string): string[] | "no draw" {
            if (now === before) return "no draw"
            const keys = arrivedOnDraw(expecting, before, now)
            expecting = afterDraw(expecting)
            before = now
            return keys
        },
    }
}

describe("a list drawn again after someone else's change", () => {
    it("marks the rows they added, and those holding something new", () => {
        const page = list([A, B])
        page.signal()
        expect(page.draw(at([C, A, { ...B, status: "COMPLETED" }]))).toEqual(["c", "b"])
    })

    it("marks nothing for a row that went, or rows that only moved", () => {
        const page = list([A, B, C])
        page.signal()
        expect(page.draw(at([C, A]))).toEqual([])
    })

    it("marks nothing on another tab, filter or page, though a signal came", () => {
        const page = list([A, B])
        page.signal()
        expect(page.draw(at([C], "/dashboard/tasks?status=PENDING"))).toEqual([])
        expect(arrivedBetween(at([A]), at([A, C], "/dashboard/tasks?page=2"))).toEqual([])
    })

    it("marks nothing for a draw no signal announced", () => {
        const page = list([A])
        expect(page.draw(at([A, C]))).toEqual([])
    })

    it("marks only the draw that follows the signal, and nothing after it", () => {
        const page = list([A])
        page.signal()
        expect(page.draw(at([A, B]))).toEqual(["b"])
        expect(page.draw(at([A, B, C]))).toEqual([])
    })

    it("waits for a draw that changes something: a signal for another page's rows draws nothing here", () => {
        const page = list([A])
        page.signal()
        expect(page.draw(at([A]))).toBe("no draw")
        page.signal()
        expect(page.draw(at([A, C]))).toEqual(["c"])
    })

    it("forgets a signal whose draw changed nothing, after 10 seconds, so it can't claim the person's change later", () => {
        expect(EXPECT_MS).toBe(10_000)
        const page = list([A])
        page.signal()
        page.forget()
        expect(page.draw(at([A, C]))).toEqual([])
    })
})

describe("the person's own change", () => {
    // Said as the action starts, before it sends anything: the server can go
    // on working after it saves, so the change's signal, and the draw after
    // it, can come before the answer (found by Codex on PR 251).
    it("is never marked, whether their draw or their change's signal comes first", () => {
        const first = list([A])
        first.own()
        first.signal()
        expect(first.draw(at([A, { ...C, status: "COMPLETED" }]))).toEqual([])

        const second = list([A])
        second.signal()
        second.own()
        expect(second.draw(at([{ ...A, status: "COMPLETED" }]))).toEqual([])
    })

    it("leaves the next one someone else makes to be marked", () => {
        const page = list([A])
        page.own()
        expect(page.draw(at([{ ...A, status: "COMPLETED" }]))).toEqual([])
        // Their own change's signal, drawing what they already see.
        page.signal()
        expect(page.draw(at([{ ...A, status: "COMPLETED" }]))).toBe("no draw")
        // Then someone else's.
        page.signal()
        expect(page.draw(at([{ ...A, status: "COMPLETED" }, B]))).toEqual(["b"])
    })

    it("waits anew with each signal or action, so each gets its 10 seconds", () => {
        const was = expectNext(null, "live")
        expect(was).toEqual({ from: "live", acting: 0 })
        expect(expectNext(was, "live")).not.toBe(was)
        expect(expectNext(was, "own")).toEqual({ from: "own", acting: 0 })
        expect(expectNext({ from: "own", acting: 0 }, "live")).toEqual({ from: "own", acting: 0 })
        const answered = actionAnswered(actionStarts(was))
        expect(answered).toEqual({ from: "own", acting: 0 })
        expect(actionAnswered(answered)).not.toBe(answered)
    })

    // Every cash advance write is high-risk: a two-factor code can be asked
    // for on the way, and the action is sent again once it's typed. Typing
    // it can take longer than a signal is waited for, and the change, and
    // its signal, come only after (PR 252).
    it("is never marked however long it's on its way, and isn't forgotten meanwhile", () => {
        const page = list([A])
        const answered = page.start()
        // The code takes its time: 10 seconds and more go by.
        page.forget()
        page.forget()
        // Their change is saved, and its signal comes before their answer.
        page.signal()
        expect(page.draw(at([A, { ...C, status: "COMPLETED" }]))).toEqual([])
        answered()
        // Their page draws itself again after the answer: nothing new.
        expect(page.draw(at([A, { ...C, status: "COMPLETED" }]))).toBe("no draw")
        // Its wait over, someone else's change is marked again.
        page.forget()
        page.signal()
        expect(page.draw(at([A, B, { ...C, status: "COMPLETED" }]))).toEqual(["b"])
    })

    it("takes every draw while it's on its way as theirs, as one of them is, and the one after its answer", () => {
        const page = list([A])
        const answered = page.start()
        page.signal()
        expect(page.draw(at([A, B]))).toEqual([])
        page.signal()
        expect(page.draw(at([A, B, C]))).toEqual([])
        answered()
        expect(page.draw(at([{ ...A, status: "COMPLETED" }, B, C]))).toEqual([])
        page.signal()
        expect(page.draw(at([{ ...A, status: "COMPLETED" }, { ...B, status: "COMPLETED" }, C]))).toEqual(["b"])
    })

    it("waits for every action of theirs on its way, and is forgotten 10 seconds after the last answer", () => {
        let was = actionStarts(actionStarts(null))
        expect(was).toEqual({ from: "own", acting: 2 })
        expect(afterDraw(was)).toBe(was)
        expect(forgets(was)).toBe(false)
        was = actionAnswered(was)!
        expect(forgets(was)).toBe(false)
        was = actionAnswered(was)!
        expect(was).toEqual({ from: "own", acting: 0 })
        expect(forgets(was)).toBe(true)
        expect(afterDraw(was)).toBeNull()
        expect(forgets(null)).toBe(false)
        expect(actionAnswered(null)).toBeNull()
    })
})

describe("each row's mark", () => {
    const none: Marks = new Map()

    it("goes 2 seconds after the draw that marked it, whatever draws come after", () => {
        const first = mark(none, ["a"], 1)
        const second = mark(first, ["b"], 2)
        const left = unmark(second, 1)
        expect([...left.keys()]).toEqual(["b"])
        expect(unmark(left, 2).size).toBe(0)
    })

    it("stays for the later draw's 2 seconds when the row changes again", () => {
        const again = mark(mark(none, ["a", "b"], 1), ["a"], 2)
        expect([...unmark(again, 1).keys()]).toEqual(["a"])
        expect(unmark(unmark(again, 1), 2).size).toBe(0)
    })

    it("leaves the marks as they are when that draw's rows are all marked again", () => {
        const again = mark(mark(none, ["a"], 1), ["a"], 2)
        expect(unmark(again, 1)).toBe(again)
    })
})

describe("the hook (components/useArrivals.ts)", () => {
    const hook = stripComments(readFileSync("components/useArrivals.ts", "utf8"))

    it("compares each draw with the one before it, where the list is and what each row holds", () => {
        expect(hook).toContain("return useArrivalsIn(kind, `${usePathname()}?${useSearchParams().toString()}`, rows, rowKey)")
        expect(hook).toContain("const now = drawn(scope, rows, rowKey)")
        expect(hook).toMatch(/useAdjustOnChange\(\[now\], \(\) => \{\s*const keys = arrivedOnDraw\(expecting, before, now\)\s*if \(keys\.length > 0\) \{\s*setArrived\(was => mark\(was, keys, marked \+ 1\)\)\s*setMarked\(marked \+ 1\)\s*\}\s*setExpecting\(afterDraw\)\s*setBefore\(now\)\s*\}\)/)
    })

    it("marks nothing as the page opens: the first draw has none before it", () => {
        expect(hook).toContain("const [before, setBefore] = useState(now)")
        expect(readFileSync("lib/useAdjustOnChange.ts", "utf8")).toContain("Deliberately does nothing on the first render")
    })

    it("hears the list's signal, and the page says when the draw is its own, and when its action is answered", () => {
        expect(hook).toContain("useLive(kind, () => setExpecting(was => expectNext(was, 'live')))")
        expect(hook).toMatch(/const own = \(\) => \{\s*setExpecting\(actionStarts\)\s*let answered = false\s*return \(\) => \{\s*if \(answered\) return\s*answered = true\s*setExpecting\(actionAnswered\)\s*\}\s*\}/)
        expect(hook).toContain("return { arrived, own }")
    })

    it("forgets what it waited for after EXPECT_MS, not while an action is on its way, and marks each draw's rows for their own ARRIVAL_MS, 2 seconds", () => {
        expect(hook).toMatch(/if \(!forgets\(expecting\)\) return\s*const forget = setTimeout\(\(\) => setExpecting\(null\), EXPECT_MS\)/)
        // Not cleared as the next draw comes, which would keep every row marked.
        expect(hook).toMatch(/useEffect\(\(\) => \{\s*if \(marked === 0\) return\s*setTimeout\(\(\) => setArrived\(was => unmark\(was, marked\)\), ARRIVAL_MS\)\s*\}, \[marked\]\)/)
        expect(ARRIVAL_MS).toBe(2000)
    })
})

describe("the lists", () => {
    it("mark the rows on the table and on the phone's cards alike", async () => {
        const { DataList } = await import("@/components/ui/DataList")
        const html = renderToStaticMarkup(h(DataList<Row>, {
            caption: "Tasks", rows: [A, B], rowKey: key, arrived: new Set(["b"]),
            columns: [{ key: "title", header: "Title", cell: r => r.title }], card: r => r.title,
        }))
        expect(html).toContain('<tr data-key="a">')
        expect(html).toContain('<tr data-key="b" data-arrived="true">')
        expect(html).toContain('<li data-key="a">')
        expect(html).toContain('<li data-key="b" data-arrived="true">')
        expect(renderToStaticMarkup(h(DataList<Row>, { caption: "Tasks", rows: [A], rowKey: key, columns: [], card: r => r.title }))).not.toContain("data-arrived")
    })

    it("are the tasks, which nothing on the list changes", () => {
        const tasks = stripComments(readFileSync("app/(dashboard)/dashboard/tasks/TasksClient.tsx", "utf8"))
        expect(tasks).toContain("const arrivals = useArrivals('tasks', sorted, task => task.id)")
        expect(tasks).toContain("arrived={arrivals.arrived}")
        expect(tasks).not.toContain("arrivals.own()")
    })

    it("and the requests, where each action, the dialogs' too, says as it starts that the next draw is the person's own", () => {
        const requests = stripComments(readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8"))
        expect(requests).toContain("const arrivals = useArrivals('requests', rows, r => r.id)")
        expect(requests).toContain("arrived={arrivals.arrived}")
        // The page's own actions, and every dialog's.
        expect(requests).toContain("const action = useBusyAction(arrivals.own)")
        const from = requests.indexOf("<ActionStarts.Provider value={arrivals.own}>")
        const to = requests.indexOf("</ActionStarts.Provider>")
        expect(from).toBeGreaterThan(-1)
        for (const dialog of ["<DecideDayOff", "<RejectRequest", "<WithdrawAttendance", "<RevokePhone", "<NewRequest"]) {
            const at = requests.indexOf(dialog)
            expect([dialog, at > from && at < to]).toEqual([dialog, true])
        }
        // Every write on the page and in its dialogs goes through a busy action.
        for (const file of ["RequestsClient", "DayOffDialogs", "AttendanceDialogs"]) {
            const source = stripComments(readFileSync(`app/(dashboard)/dashboard/requests/${file}.tsx`, "utf8"))
            const writes = source.match(/method: '(POST|PATCH|PUT|DELETE)'/g)?.length ?? 0
            expect([file, writes > 0, source.includes("useBusyAction(")]).toEqual([file, true, true])
        }
    })

    // Part 4a (PR 252): their search, filter and page are their own, so the
    // address each is loaded from says which list is drawn.
    it("and a company's cash advances and a person's, where giving, returning, correcting, confirming and moving are the person's own", () => {
        const advances = stripComments(readFileSync("components/cash-advances/CashAdvancesList.tsx", "utf8"))
        expect(advances).toContain("const arrivals = useArrivalsIn('advances', listUrl ?? '', holders, h => h.id)")
        expect(advances).toContain("arrived={arrivals.arrived}")
        expect(advances).toMatch(/<ActionStarts\.Provider value=\{arrivals\.own\}>\s*<CashAdvanceDialog/)
        const history = stripComments(readFileSync("components/cash-advances/CashAdvanceHistory.tsx", "utf8"))
        expect(history).toContain("const arrivals = useArrivalsIn('advances', url, advance?.data ?? [], e => e.id)")
        expect(history).toContain("arrived={arrivals.arrived}")
        expect(history).toContain("const action = useBusyAction(arrivals.own)")
        expect(history).toContain("onConfirm={() => action.run('move', move)}")
        expect(history).toContain("onConfirm={() => action.run('confirm', confirm)}")
        expect(history).toMatch(/<ActionStarts\.Provider value=\{arrivals\.own\}>\s*<CashAdvanceDialog/)
        // Its window's save is a busy action, so it hears the ActionStarts around it.
        const dialog = stripComments(readFileSync("components/cash-advances/CashAdvanceDialog.tsx", "utf8"))
        expect(dialog).toContain("const action = useBusyAction()")
        expect(dialog).toContain("void action.run('save', () => send(person))")
        // The hooks come before the pages' early returns: a hook can't be skipped.
        expect(advances.indexOf("useArrivalsIn(")).toBeLessThan(advances.indexOf("if (!listUrl) return"))
        expect(history.indexOf("useArrivalsIn(")).toBeLessThan(history.indexOf("if (!advance) {"))
    })

    it("hear an action starting before it sends anything (lib/useBusyAction.ts)", () => {
        const busy = stripComments(readFileSync("lib/useBusyAction.ts", "utf8"))
        expect(busy).toContain("export type ActionStart = () => () => void")
        expect(busy).toContain("export const ActionStarts = createContext<ActionStart | null>(null)")
        expect(busy).toContain("const start = onStart ?? told")
        expect(busy).toMatch(/if \(inFlight\.current\) return undefined\s*inFlight\.current = key\s*const answered = start\?\.\(\)\s*setCurrent\(key\)\s*try \{\s*return await work\(\)\s*\} finally \{\s*answered\?\.\(\)/)
    })
})

describe("the bell's count", () => {
    it("grows as it rises: not from the server's count to the first answer, and not as it falls or stays", () => {
        expect(rose(null, 3)).toBe(false)
        expect(rose(3, 3)).toBe(false)
        expect(rose(3, 2)).toBe(false)
        expect(rose(0, 1)).toBe(true)
        expect(rose(2, 3)).toBe(true)
    })

    it("is drawn again for each rise, so it grows each time", () => {
        const bell = stripComments(readFileSync("components/NotificationBell.tsx", "utf8"))
        expect(bell).toContain("const answered = data ? unreadCount : null")
        expect(bell).toContain("const [counted, setCounted] = useState(answered)")
        expect(bell).toMatch(/useAdjustOnChange\(\[answered\], \(\) => \{\s*if \(answered === null\) return\s*if \(rose\(counted, answered\)\) setRises\(n => n \+ 1\)\s*setCounted\(answered\)\s*\}\)/)
        expect(bell).toContain('<span key={rises} className="ui-topbar-count" data-rising={rises > 0 || undefined} aria-hidden="true">')
    })
})

describe("the motion (components/ui/ui.css)", () => {
    const css = stripComments(readFileSync("components/ui/ui.css", "utf8"))
    const doc = readFileSync("DESIGN.md", "utf8").replace(/\s+/g, " ")
    const ROWS = ".ui-table tr[data-arrived] td,\n.ui-cards > li[data-arrived] .ui-list-card {"
    const REDUCE = "@media (prefers-reduced-motion: reduce) {"
    const body = (from: number) => css.slice(css.indexOf("{", from) + 1, css.indexOf("}", from)).replace(/\s+/g, " ").trim()
    const keyframes = (name: string) => {
        const start = css.indexOf(`@keyframes ${name} {`)
        expect(start, name).toBeGreaterThan(-1)
        return css.slice(start, css.indexOf("}\n}", start) + 3).replace(/\s+/g, " ")
    }
    const reduce = css.lastIndexOf(REDUCE)

    it("tints a row, on the table and on a card, for 2 seconds, evenly", () => {
        const rows = css.indexOf(ROWS)
        expect(rows).toBeGreaterThan(-1)
        expect(rows).toBeLessThan(reduce)
        expect(body(rows)).toBe("animation: ui-arrived 2s linear;")
        expect(ARRIVAL_MS).toBe(2 * 1000)
    })

    it("holds the tint for half a second, then fades to the row's own colour, overdue's too, changing nothing else", () => {
        // No last keyframe: it ends on the colour the row has without it.
        expect(keyframes("ui-arrived")).toBe("@keyframes ui-arrived { from, 25% { background-color: var(--brand-tint); } }")
    })

    it("grows the bell's count to 115% and settles it back in 250ms", () => {
        const count = css.indexOf(".ui-topbar-count[data-rising] {")
        expect(count).toBeGreaterThan(-1)
        expect(count).toBeLessThan(reduce)
        expect(body(count)).toBe("animation: ui-count-rise 250ms var(--ease-out);")
        expect(keyframes("ui-count-rise")).toBe("@keyframes ui-count-rise { 40% { transform: scale(1.15); } }")
    })

    it('with "reduce motion", shows the tint for its 2 seconds without fading, and doesn\'t grow the count', () => {
        const block = css.slice(reduce, css.indexOf("/* end of the motion */") > -1 ? css.indexOf("/* end of the motion */") : css.length)
        expect(block).toMatch(/\.ui-topbar-count\[data-rising\] \{\s*animation: none;\s*\}/)
        expect(block).toMatch(/\.ui-table tr\[data-arrived\] td,\s*\.ui-cards > li\[data-arrived\] \.ui-list-card \{\s*animation: none;\s*background-color: var\(--brand-tint\);\s*\}/)
        // After the rows' own colours, so the tint shows on an overdue row too.
        expect(css.indexOf(".ui-table tr[data-tone=\"overdue\"] td")).toBeLessThan(reduce)
        expect(css.indexOf(".ui-cards > li[data-tone=\"overdue\"] .ui-list-card")).toBeLessThan(reduce)
    })

    it("is as DESIGN.md §8 says", () => {
        expect(doc).toContain("**a row that arrives or changes,** in a list such as the tasks or the requests, takes the soft brand tint (`--brand-tint`), which fades back to the row's own colour")
        expect(doc).toContain("2 seconds for a row's tint: it holds for half a second")
        expect(doc).toContain("250ms for the bell's count growing to 115% and settling back, on `--ease-out`")
        expect(doc).toContain("A row's tint is the one that says something: it shows for its 2 seconds and goes without fading, and the bell's count doesn't grow.")
        expect(doc).toContain("**only for what someone else did:** not for the person's own changes, which they know of, and not as a page opens. What changed while a tab was out of sight is shown as it comes back.")
    })
})
