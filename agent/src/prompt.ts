import { createInterface } from "node:readline"
import type { Readable, Writable } from "node:stream"

/**
 * Asks for a password at the command line without showing it as it's typed
 * (ATTENDANCE_PLAN.md §17.4, PR 302): `probe hikvision` asks for the agent
 * user's password rather than taking it after the command, where the
 * console's history would keep it.
 *
 * At a console, keys are read one by one: Backspace takes back the last
 * one, Enter ends, Ctrl+C stops. From a pipe, as a script gives it, the
 * first line is the password. The prompt goes to `output`, so what the
 * command prints stays clean to read.
 */

type Console = Readable & { isTTY?: boolean; setRawMode?: (on: boolean) => unknown }

export function readSecret(prompt: string, input: Console = process.stdin, output: Writable = process.stderr): Promise<string> {
    output.write(prompt)
    if (!input.isTTY || typeof input.setRawMode !== "function") {
        return new Promise<string>(resolve => {
            const lines = createInterface({ input, terminal: false })
            let answered = false
            lines.once("line", line => {
                answered = true
                lines.close()
                resolve(line)
            })
            lines.once("close", () => { if (!answered) resolve("") })
        })
    }
    const setRawMode = input.setRawMode.bind(input)
    return new Promise<string>((resolve, reject) => {
        let typed = ""
        const done = (fail?: Error) => {
            input.off("data", onData)
            setRawMode(false)
            input.pause()
            output.write("\n")
            if (fail) reject(fail)
            else resolve(typed)
        }
        const onData = (chunk: Buffer | string) => {
            for (const ch of String(chunk)) {
                if (ch === "\r" || ch === "\n") return done()
                if (ch === "\u0003") return done(new Error("Stopped."))
                if (ch === "\u007f" || ch === "\b") typed = Array.from(typed).slice(0, -1).join("")
                else if (ch >= " ") typed += ch
            }
        }
        setRawMode(true)
        input.on("data", onData)
        input.resume()
    })
}
