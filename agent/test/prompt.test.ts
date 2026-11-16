import { describe, it, expect } from "vitest"
import { PassThrough } from "node:stream"
import { readSecret } from "../src/prompt"

/**
 * Asking for a terminal user's password at the command line (`probe
 * hikvision`, ATTENDANCE_PLAN.md §17.4, PR 302): never shown as it's typed,
 * and never taken from the command line, whose history would keep it.
 */

/** A console, as the agent's input is when a person types at it. */
class Console extends PassThrough {
    isTTY = true
    raw = false
    setRawMode(on: boolean) {
        this.raw = on
        return this
    }
}

const screen = () => {
    const out = new PassThrough()
    let shown = ""
    out.on("data", chunk => { shown += String(chunk) })
    return { out, shown: () => shown }
}

describe("asking for a password", () => {
    it("shows nothing of what's typed, takes back what's deleted, and ends at Enter", async () => {
        const input = new Console()
        const { out, shown } = screen()
        const typed = readSecret("Password for agent: ", input, out)
        expect(input.raw).toBe(true)
        input.write("Corx\u007frect Horse 9")
        input.write("\r")
        expect(await typed).toBe("Correct Horse 9")
        expect(shown()).toBe("Password for agent: \n")
        // The console as it was, for whatever comes after.
        expect(input.raw).toBe(false)
    })

    it("takes Enter as a new line too, and a backspace with nothing typed as nothing", async () => {
        const input = new Console()
        const typed = readSecret("Password: ", input, screen().out)
        input.write("\b\u007fab\bc\n")
        expect(await typed).toBe("ac")
    })

    it("stops at Ctrl+C, giving back the console", async () => {
        const input = new Console()
        const typed = readSecret("Password: ", input, screen().out)
        input.write("secr\u0003")
        await expect(typed).rejects.toThrow("Stopped")
        expect(input.raw).toBe(false)
    })

    it("reads one line from a pipe, as a script gives it", async () => {
        const input = new PassThrough()
        const { out, shown } = screen()
        const typed = readSecret("Password: ", input, out)
        input.end("Correct Horse 9\nnext line\n")
        expect(await typed).toBe("Correct Horse 9")
        expect(shown()).toBe("Password: ")
    })
})
