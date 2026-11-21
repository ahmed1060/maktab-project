import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * What the first customer's setup found in the agent's README
 * (ATTENDANCE_PLAN.md §17.13, set up on 21 November 2026; PR 354): the
 * office PC opened PowerShell, where a program in the folder needs `.\`
 * before it, and the terminal there kept its comm key under PC Connection.
 */

const readme = () => readFileSync("agent/README.md", "utf8")
const install = () => readme().slice(readme().indexOf("## Install"), readme().indexOf("## A Hikvision terminal"))

describe("the agent's README, as the first customer's setup found it", () => {
    it("says how to reach the agent's folder from the administrator's prompt", () => {
        expect(install()).toContain('cd "C:\\Program Files\\Nizmo Agent"')
        // Before the first command run there.
        expect(install().indexOf('cd "C:\\Program Files\\Nizmo Agent"')).toBeLessThan(install().indexOf("nizmo-agent.exe probe 192.168.1.20"))
    })

    it("says PowerShell needs .\\ before each command, with the probe as it's typed there", () => {
        expect(install()).toContain("PowerShell")
        expect(install()).toContain(".\\nizmo-agent.exe probe 192.168.1.20")
        // Command Prompt stays the way the steps are written.
        expect(install()).toContain("Command Prompt")
    })

    it("names both places a terminal keeps its comm key", () => {
        const need = readme().slice(readme().indexOf("## What you need"), readme().indexOf("## Install"))
        expect(need).toContain("**Menu → Comm. → Comm Key**")
        expect(need).toContain("**Menu → Comm. → PC Connection → Comm Key**")
    })
})
