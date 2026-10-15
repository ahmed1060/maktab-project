/**
 * A link to the Tasks list showing the tasks a number counted.
 *
 * A Team Leader's numbers on the dashboard are their team's, their own tasks
 * among them, but the Tasks page opens on their own tasks alone. So their
 * links ask for the team's view, which is the same tasks the number counted.
 * Anyone else's list is already what their numbers count.
 */
export function tasksListHref({ status, teamOnly }: { status?: string; teamOnly: boolean }): string {
    const params = new URLSearchParams()
    if (teamOnly) params.set('view', 'team')
    if (status) params.set('status', status)
    const query = params.toString()
    return query ? `/dashboard/tasks?${query}` : '/dashboard/tasks'
}
