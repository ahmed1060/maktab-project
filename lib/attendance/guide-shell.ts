import { useSyncExternalStore } from "react"
import { COMMAND_SHELLS, type CommandShell } from "./setup-guide"

/**
 * The program the setup guide's commands are typed in (ATTENDANCE_PLAN.md
 * §17.7; DESIGN.md §5.5, A guide's page; PR 356), kept in the browser for
 * next time, as the office PC is the one that opens it again. Read as an
 * external store, as the Super Admin's company is (lib/company-selection.ts):
 * the server draws Command Prompt, and the browser what it kept, with no
 * effect copying one into the other.
 */

export const GUIDE_SHELL_KEY = "terminalGuideShell"
const listeners = new Set<() => void>()
// Where the choice lives when the browser keeps nothing (storage blocked):
// until the page is reloaded.
let unstored: CommandShell = "CMD"

const isShell = (value: unknown): value is CommandShell => (COMMAND_SHELLS as readonly unknown[]).includes(value)

/** What was kept; Command Prompt for nothing kept, or anything else. */
export function readGuideShell(): CommandShell {
    try {
        const stored = localStorage.getItem(GUIDE_SHELL_KEY)
        return isShell(stored) ? stored : "CMD"
    } catch {
        return unstored
    }
}

export function writeGuideShell(shell: CommandShell): void {
    unstored = shell
    try {
        localStorage.setItem(GUIDE_SHELL_KEY, shell)
    } catch {
        // Storage blocked: `unstored` carries it instead.
    }
    for (const listener of listeners) listener()
}

export function subscribeGuideShell(onChange: () => void): () => void {
    listeners.add(onChange)
    // Picked in another tab, as the guide may be open beside Fingerprint terminals.
    const onStorage = (e: StorageEvent) => {
        if (e.key === GUIDE_SHELL_KEY || e.key === null) onChange()
    }
    window.addEventListener("storage", onStorage)
    return () => {
        listeners.delete(onChange)
        window.removeEventListener("storage", onStorage)
    }
}

/** The program picked, and picking another. */
export function useGuideShell(): [CommandShell, (shell: CommandShell) => void] {
    const shell = useSyncExternalStore<CommandShell>(subscribeGuideShell, readGuideShell, () => "CMD")
    return [shell, writeGuideShell]
}
