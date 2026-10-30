/** The longest a task's title and description may be, as the server takes them. */
export const TASK_TITLE_MAX = 100
export const TASK_DESCRIPTION_MAX = 1000

/** The fields of Create task in the order they're in, for the first one wrong to take the focus. */
export const TASK_FIELDS = ['title', 'description', 'locationId', 'assigneeIds', 'deadline', 'difficulty'] as const
