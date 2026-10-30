/** The longest a task's title and description may be, as the server takes them. */
export const TASK_TITLE_MAX = 100
export const TASK_DESCRIPTION_MAX = 1000

/** The fields of Create task in the order they're in, for the first one wrong to take the focus. */
const ORDER = ['title', 'description', 'locationId', 'assigneeIds', 'deadline', 'difficulty']

/** The first field, in the form's order, that has an error; none when nothing's wrong. */
export function firstError(errors: Record<string, string>): string | null {
    return ORDER.find(field => errors[field]) ?? Object.keys(errors).find(field => errors[field]) ?? null
}
