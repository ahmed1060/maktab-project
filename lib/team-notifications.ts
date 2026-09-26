/**
 * Who hears about a change of team, and how often.
 *
 * The rule that matters is at most one notification per person per change. A
 * bulk assignment of forty people to one leader must reach that leader once,
 * as "40 people joined your team", not forty times — otherwise the first bulk
 * assignment teaches every leader to ignore the bell, and the notifications
 * that matter afterwards are ignored with it.
 *
 * Each employee who moved hears once too. Forty employees getting one message
 * each is not a storm; one leader getting forty is.
 *
 * A pure function, so that rule can be tested without a database. The caller
 * loads names and writes the notifications.
 */

export type TeamMove = { userId: string; from: string | null; to: string | null }

export type PlannedNotification = { userId: string; message: string; relatedId: string }

type Names = Map<string, string>

export function planTeamNotifications(moves: TeamMove[], names: Names): PlannedNotification[] {
    // A "move" to where somebody already is changes nothing and says nothing.
    const real = moves.filter(m => m.from !== m.to)
    const out: PlannedNotification[] = []

    // 1. Each person who moved.
    for (const m of real) {
        const leader = m.to ? names.get(m.to) : null
        out.push({
            userId: m.userId,
            message: m.to
                ? `Your team leader is now ${leader ?? "someone new"}.`
                // Said plainly, because it has a consequence they may not
                // guess: no team leader can see their work until an Admin
                // assigns them again.
                : "You are no longer assigned to a team leader. An administrator will assign you again.",
            relatedId: `/dashboard/employees/${m.userId}`,
        })
    }

    // 2. Each leader, once, however many people moved in or out.
    const joined = new Map<string, string[]>()
    const left = new Map<string, string[]>()
    for (const m of real) {
        if (m.to) joined.set(m.to, [...(joined.get(m.to) ?? []), m.userId])
        if (m.from) left.set(m.from, [...(left.get(m.from) ?? []), m.userId])
    }

    const leaders = new Set([...joined.keys(), ...left.keys()])
    for (const leaderId of leaders) {
        const inn = joined.get(leaderId) ?? []
        const out_ = left.get(leaderId) ?? []
        const parts: string[] = []
        if (inn.length) parts.push(describe(inn, names, "joined"))
        if (out_.length) parts.push(describe(out_, names, "left"))
        out.push({
            userId: leaderId,
            message: `${parts.join(" and ")} your team.`,
            relatedId: "/dashboard/employees",
        })
    }

    return out
}

/** One name when it is one person; a count when it is more. A list of forty
 *  names is not a notification, it is a report. */
function describe(ids: string[], names: Names, verb: "joined" | "left"): string {
    if (ids.length === 1) return `${names.get(ids[0]) ?? "Someone"} ${verb}`
    return `${ids.length} people ${verb}`
}
