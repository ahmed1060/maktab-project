import { can, type Actor } from "../can"
import { PROTECTED_FIELDS } from "./fields"

/** The fields a User response may carry that decide what shapeUser does. */
type UserLike = {
    id: string
    companyId?: string | null
    teamLeaderId?: string | null
    salary?: unknown
}

/**
 * A User row as this viewer may see it.
 *
 * Salary stays for the person themselves and for anyone holding salary.view
 * over them — checked against the row, so a grant for one company never reveals
 * another's. It is also turned into a number: Prisma returns a Decimal, whose
 * JSON form is a string, and the screens do arithmetic on it.
 */
export type Shaped<T> = Omit<T, "salary"> & { salary?: number }

export function shapeUser<T extends UserLike>(actor: Actor, user: T): Shaped<T> {
    if (!("salary" in user)) return user as Shaped<T>
    const { salary, ...rest } = user
    const own = !!actor.id && actor.id === user.id
    const target = { companyId: user.companyId, userId: user.id, teamLeaderId: user.teamLeaderId }
    if (own || can(actor, PROTECTED_FIELDS.User.salary, target)) return { ...rest, salary: Number(salary) }
    return rest
}
