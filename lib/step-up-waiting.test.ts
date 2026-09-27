import { describe, it, expect } from "vitest"
import { stepUpWaiting } from "./step-up-waiting"

describe("requests waiting on the step-up prompt", () => {
    it("share one prompt, and its answer settles every one", async () => {
        const waiting = stepUpWaiting()
        let shown = 0
        const first = waiting.wait(() => shown++)
        const second = waiting.wait(() => shown++)
        expect(shown).toBe(1)
        waiting.settle(true)
        expect(await Promise.all([first, second])).toEqual([true, true])
    })

    it("are all refused when it is cancelled", async () => {
        const waiting = stepUpWaiting()
        const both = [waiting.wait(() => {}), waiting.wait(() => {})]
        waiting.settle(false)
        expect(await Promise.all(both)).toEqual([false, false])
    })

    it("show the prompt again for a request after it was answered", async () => {
        const waiting = stepUpWaiting()
        let shown = 0
        const first = waiting.wait(() => shown++)
        waiting.settle(true)
        await first
        const next = waiting.wait(() => shown++)
        expect(shown).toBe(2)
        waiting.settle(false)
        expect(await next).toBe(false)
    })
})
