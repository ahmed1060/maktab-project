import type { Can } from '@/lib/useCan'

/**
 * What a person's profile shows, and offers, to whoever is looking (a
 * person's profile, part 2, PR 192): each with the permission its route
 * checks, in one place for the view of someone else's and for the form.
 *
 * Some ask what the person is, not what the viewer may do: only an employee
 * has a team leader, an Admin is paid outside payroll, and only the Super
 * Admin acts on an Admin (ROLES_PLAN.md §4.2, rule 7).
 */
export type ProfileAccess = {
    /** Their own profile. */
    own: boolean
    /** Edit, from the view. */
    edit: boolean
    company: boolean
    salary: boolean
    dayOffCredit: boolean
    resetPassword: boolean
    role: boolean
    /** One's own team leader, on one's own profile. */
    ownTeamLeader: boolean
    /** An employee's team leader, to whoever assigns teams. */
    teamLeader: boolean
    status: boolean
    /** Beside their status: ending their contract, or reinstating them. */
    endContract: boolean
}

export function profileAccess({ can, viewer, person }: {
    can: Can['can']
    viewer: { id?: string | null; role?: string | null } | null | undefined
    /** Their role's kind, '' until it's loaded. */
    person: { id: string; role: string }
}): ProfileAccess {
    const own = !!viewer?.id && person.id === viewer.id
    const superAdmin = viewer?.role === 'SUPER_ADMIN'
    const actsOnThem = person.role !== 'ADMIN' || superAdmin
    const paid = !['ADMIN', 'SUPER_ADMIN'].includes(person.role) && person.role !== ''
    return {
        own,
        edit: own || (can('employees.edit') && actsOnThem),
        company: superAdmin || person.role === 'SUPER_ADMIN',
        salary: (can('salary.view') || own) && paid,
        dayOffCredit: (can('dayoff.view') || own) && paid,
        resetPassword: can('employees.reset_password') && !own && actsOnThem,
        role: (can('employees.assign_role') || can('employees.request_role')) && !own,
        ownTeamLeader: own && person.role === 'EMPLOYEE',
        teamLeader: can('employees.assign_team') && !own && person.role === 'EMPLOYEE',
        status: can('employees.change_status') && !own,
        // As its route asks: changing a status doesn't end a contract.
        endContract: can('employees.end_contract') && !own && actsOnThem,
    }
}
