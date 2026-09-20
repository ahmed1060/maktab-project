/**
 * Who may be given a team leader, and who may be one.
 *
 * A pure function, for the reason lib/approval.ts is one: these are the rules
 * of a permission boundary, and they should be readable and testable in one
 * place rather than scattered through a service as early returns nobody reads
 * twice. The caller loads the two rows and asks; it does not re-derive the
 * rules at each call site.
 *
 * The structure is flat — leaders are not led. Everything here follows from
 * that one decision:
 *
 *   - only an EMPLOYEE may have a leader, so a leader can never acquire one;
 *   - a leader must actually hold TEAM_LEADER, so the role and the relation
 *     cannot disagree;
 *   - and together those two make a reporting cycle impossible by
 *     construction. There is no cycle check here because there is nothing to
 *     check: a cycle needs somebody who is both led and leading, and no row
 *     can be both.
 *
 * That is worth stating plainly, because the obvious alternative — a Team
 * table, or letting leaders lead leaders — turns every scoped query into a
 * tree walk and every assignment into a cycle hunt.
 */

/** Only the fields these rules read. Deliberately not the Prisma type: this
 *  has to be callable from a test with two object literals. */
export type Person = {
    id: string
    role: string
    companyId: string | null
    status?: string | null
}

export type TeamRefusal =
    | { code: "SELF_LEADERSHIP"; message: string }
    | { code: "NOT_A_LEADER"; message: string }
    | { code: "ONLY_EMPLOYEES_HAVE_LEADERS"; message: string }
    | { code: "DIFFERENT_COMPANY"; message: string }
    | { code: "LEADER_UNAVAILABLE"; message: string }

export type TeamVerdict = { ok: true } | { ok: false; refusal: TeamRefusal }

/** A leader who has been archived or deleted cannot take on new reports —
 *  they would be invisible to the person supposedly managing them. OFFLINE is
 *  not one of these: it means "not signed in right now". */
const UNAVAILABLE = new Set(["DELETED", "ARCHIVED"])

/**
 * `leader` is null for "no leader", which is always allowed: unassigning is
 * how an Admin resolves a hand-off, and it is the state every account starts
 * in. Refusing it would make the hand-off flow impossible.
 */
export function checkTeamAssignment(target: Person, leader: Person | null): TeamVerdict {
    if (leader === null) return { ok: true }

    // First, because it is the one the database also enforces and the one that
    // makes the others read strangely if it slips through.
    if (leader.id === target.id) {
        return {
            ok: false,
            refusal: { code: "SELF_LEADERSHIP", message: "Somebody cannot be their own team leader." },
        }
    }

    if (target.role !== "EMPLOYEE") {
        return {
            ok: false,
            refusal: {
                code: "ONLY_EMPLOYEES_HAVE_LEADERS",
                message: "Only employees are assigned to a team leader. Admins and team leaders are not.",
            },
        }
    }

    if (leader.role !== "TEAM_LEADER") {
        return {
            ok: false,
            refusal: {
                code: "NOT_A_LEADER",
                message: "That person is not a team leader, so nobody can be assigned to them.",
            },
        }
    }

    // After the role checks, so the message names the real problem: handing an
    // Admin from another company reads as "not a team leader", which is true
    // and more useful than "different company".
    if (!leader.companyId || leader.companyId !== target.companyId) {
        return {
            ok: false,
            refusal: {
                code: "DIFFERENT_COMPANY",
                message: "A team leader and their team must belong to the same company.",
            },
        }
    }

    if (leader.status && UNAVAILABLE.has(leader.status)) {
        return {
            ok: false,
            refusal: {
                code: "LEADER_UNAVAILABLE",
                message: "That team leader's account is archived or deleted and cannot take on a team.",
            },
        }
    }

    return { ok: true }
}

/**
 * Whether a role change has to clear this person's own leader.
 *
 * The rule that falls out of the flat structure and is easiest to miss.
 * Promoting an employee who has a leader leaves a TEAM_LEADER row with a
 * teamLeaderId — a leader who is led, which the whole design says cannot
 * exist. Nothing refuses it and no screen shows it; it simply sits there until
 * a scoped query returns something surprising.
 *
 * Deliberately not part of the hand-off flow. Losing a leader needs an Admin's
 * decision because other people's visibility depends on it; this one costs
 * nobody anything, so it is applied silently rather than made into a prompt.
 */
export function clearsOwnLeader(
    current: { role: string; teamLeaderId?: string | null },
    nextRole: string | undefined,
): boolean {
    if (!nextRole || nextRole === current.role) return false
    if (!current.teamLeaderId) return false
    return nextRole !== "EMPLOYEE"
}

/**
 * Whether a change would leave this person unable to lead the team they have.
 *
 * Four different edits do it, and three of them do not look like demotion at
 * all, which is why this is one function rather than a condition repeated at
 * each site:
 *
 *   - the role moves away from TEAM_LEADER;
 *   - the account is archived or deleted (the app soft-deletes, so the
 *     foreign key's ON DELETE SET NULL never fires for this);
 *   - the account moves to another company, which strands the reports across
 *     a boundary the whole system exists to hold;
 *
 * In every case the reports keep pointing at somebody who can no longer see
 * them, and because unassigned employees are visible to Admins only, they
 * become invisible to every team leader at once. Nothing errors. Nobody is
 * told. That is the failure this prevents: the caller must refuse the change
 * until an Admin says where those people go.
 *
 * Note the asymmetry with clearsOwnLeader above. Gaining a role silently
 * clears the leader you had, because that costs nobody anything. Losing one is
 * refused, because other people's visibility depends on the answer.
 */
export function stripsLeadership(
    current: { role: string; companyId: string | null; status?: string | null },
    next: { role?: string; companyId?: string | null; status?: string | null },
): boolean {
    if (current.role !== "TEAM_LEADER") return false

    if (next.role !== undefined && next.role !== "TEAM_LEADER") return true
    if (next.status !== undefined && next.status !== null && UNAVAILABLE.has(next.status)) return true
    if (next.companyId !== undefined && next.companyId !== current.companyId) return true

    return false
}
