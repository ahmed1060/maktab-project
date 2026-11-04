import { prisma } from "./prisma";
import { codeCandidates, getInitials } from "./username-code";

export { getInitials };

/**
 * Usernames Nizmo makes up: the company's own code and the next number,
 * counting from 0 (ds0, ds1…). Each company has a code of its own
 * (lib/username-code.ts), and a counter rather than the highest number
 * anybody has, so a number is never given twice, even once its person has
 * gone, and two people added at once never get the same one.
 */

/** Letters only, so a code is safe inside a pattern. */
const LETTERS = /^[a-z]+$/

function letters(code: string): string {
    const lower = code.toLowerCase()
    if (!LETTERS.test(lower)) throw new Error("INVALID_USERNAME_CODE")
    return lower
}

const isUniqueViolation = (error: unknown) => (error as { code?: string })?.code === "P2002"

/**
 * Whether anybody, a company's person or a Super Admin, has this username,
 * capitals aside: one username, one account, wherever it's set. `exceptId`
 * is the account being changed, whose own username isn't a clash.
 */
export async function usernameTaken(username: string, exceptId: string | null = null): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ taken: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM "User" WHERE lower(username) = lower(${username}) AND id IS DISTINCT FROM ${exceptId}::text)
            OR EXISTS (SELECT 1 FROM "SuperAdmin" WHERE lower(username) = lower(${username}) AND id IS DISTINCT FROM ${exceptId}::text) AS taken`
    return rows[0]?.taken === true
}

/**
 * A free username from a base (a Super Admin's from their email): the base,
 * or with -2, -3… after it. A hyphen, so it never looks like a company's
 * code and a number.
 */
export async function freeUsername(base: string): Promise<string> {
    for (let n = 1; n < 100; n++) {
        const name = n === 1 ? base : `${base}-${n}`
        if (!(await usernameTaken(name)) && !(await usernameReserved(name, null))) return name
    }
    throw new Error("USERNAME_UNAVAILABLE")
}

/**
 * Which of these codes a company can't have: another company has it, or
 * another company's people have usernames that follow it (ds2 rules out ds),
 * so the two would share a run of numbers.
 */
export async function codesInUse(codes: string[], companyId: string | null): Promise<Set<string>> {
    const asked = codes.map(letters)
    if (asked.length === 0) return new Set()
    const rows = await prisma.$queryRaw<{ code: string }[]>`
        SELECT asked.code FROM unnest(${asked}::text[]) AS asked(code)
        WHERE EXISTS (SELECT 1 FROM "Company" WHERE "usernameCode" = asked.code AND id IS DISTINCT FROM ${companyId}::text)
           OR EXISTS (SELECT 1 FROM "User" WHERE username ~* ('^' || asked.code || '[0-9]+$') AND "companyId" IS DISTINCT FROM ${companyId}::text)`
    return new Set(rows.map(row => row.code))
}

export async function codeInUse(code: string, companyId: string | null): Promise<boolean> {
    return (await codesInUse([code], companyId)).has(letters(code))
}

/** The number a code starts at: after the highest anybody already has with it, or 0. */
export async function firstNumber(code: string): Promise<number> {
    const pattern = `^${letters(code)}[0-9]{1,9}$`
    const rows = await prisma.$queryRaw<{ next: number }[]>`
        SELECT (COALESCE(max(CAST(substring(username FROM '[0-9]+$') AS INTEGER)), -1) + 1)::int AS next
        FROM (SELECT username FROM "User" UNION ALL SELECT username FROM "SuperAdmin") AS named
        WHERE username ~* ${pattern}`
    return rows[0]?.next ?? 0
}

/** The first free code for a company's name; a company's own code is free for it. */
export async function suggestCode(name: string, companyId: string | null): Promise<string> {
    const offered = codeCandidates(name)
    const used = await codesInUse(offered, companyId)
    const free = offered.find(code => !used.has(code))
    if (free) return free
    // Every suggestion taken, which takes 30-odd companies with the same
    // initials: the initials and three letters picked at random.
    for (let tries = 0; tries < 20; tries++) {
        const random = Array.from({ length: 3 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("")
        const code = offered[0].slice(0, 5) + random
        if (!(await codeInUse(code, companyId))) return code
    }
    throw new Error("USERNAME_CODE_UNAVAILABLE")
}

/**
 * A company's code, given it the first time it's needed if it has none yet:
 * a company added before codes whose people's usernames didn't give it one.
 * Two at once settle on one, the second reading what the first set.
 */
async function codeFor(companyId: string): Promise<string | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true, usernameCode: true } })
        if (!company) return null
        if (company.usernameCode) return company.usernameCode
        const code = await suggestCode(company.name, companyId)
        try {
            const claimed = await prisma.company.updateMany({ where: { id: companyId, usernameCode: null }, data: { usernameCode: code, usernameNext: await firstNumber(code) } })
            if (claimed.count === 1) return code
        } catch (error) {
            // Another company took the same code a moment ago: suggest again.
            if (!isUniqueViolation(error)) throw error
        }
    }
    throw new Error("USERNAME_CODE_UNAVAILABLE")
}

/**
 * The next username for somebody joining a company: its code and the next
 * number on its counter, skipping one somebody already has (typed by a Super
 * Admin, say), capitals aside.
 */
export async function generateUsername(companyId: string): Promise<string> {
    const code = await codeFor(companyId)
    if (!code) return `user_${Math.random().toString(36).substring(7)}`

    for (let tries = 0; tries < 100; tries++) {
        // Counted and read in one statement, so two people added at once
        // never get the same number.
        const counted = await prisma.company.update({
            where: { id: companyId },
            data: { usernameNext: { increment: 1 } },
            select: { usernameCode: true, usernameNext: true },
        })
        const username = `${counted.usernameCode ?? code}${counted.usernameNext - 1}`
        if (!(await usernameTaken(username))) return username
    }
    throw new Error("USERNAME_UNAVAILABLE")
}

/**
 * Whether a typed username follows another company's code and a number (ds7
 * when ds is Delta Sites'), or another company's people's usernames: the
 * company would one day make it up for somebody of its own. A company's own
 * code is its own to type.
 */
export async function usernameReserved(username: string, companyId: string | null): Promise<boolean> {
    const typed = /^([a-z]+)[0-9]+$/i.exec(username.trim())
    if (!typed) return false
    const prefix = typed[1].toLowerCase()
    if (companyId) {
        const own = await prisma.company.findUnique({ where: { id: companyId }, select: { usernameCode: true } })
        if (own?.usernameCode === prefix) return false
    }
    return codeInUse(prefix, companyId)
}
