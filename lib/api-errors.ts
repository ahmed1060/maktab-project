/**
 * Refusals a service throws as a code, with the answer the person gets.
 *
 * A route answers the codes it knows itself. One that reaches the handler
 * unanswered used to become a 500, "we couldn't complete that action", with
 * an error reference, and was logged as a system fault. For an ordinary
 * refusal (leave on a day already asked for, a twenty-first attachment) that
 * is the wrong answer: the person did nothing wrong that a retry would fix,
 * and wasn't told what to change. withStandardHandler answers these instead.
 *
 * lib/api-errors.test.ts fails on any code a service throws that neither a
 * route nor this map answers, other than the few listed there as faults.
 */
export const KNOWN_REFUSALS: Record<string, { status: 400 | 403 | 404 | 409; message: string }> = {
    DATE_IN_PAST: { status: 400, message: "You can't ask for leave on a day that has passed." },
    OVERLAPPING_REQUEST: { status: 409, message: "You already have a leave request for that day." },
    ATTACHMENT_LIMIT_EXCEEDED: { status: 400, message: "A task or obligation can have at most 20 attachments." },
    COST_LIMIT_EXCEEDED: { status: 400, message: "Costs added at once can total at most 10,000." },
    COMPLETED_REQUEST_STATUS_LOCKED: { status: 400, message: "A completed request can't go back to pending or in progress." },
    INVALID_ITEM_TYPE: { status: 400, message: "Unknown item type." },
    NOTE_NOT_FOUND: { status: 404, message: "Note not found." },
    SETTLEMENT_NOT_FOUND: { status: 404, message: "Settlement not found." },
    ONLY_PAID_SUPPORTED: { status: 400, message: "A payment can only be marked as paid." },
    UNKNOWN_SUBSCRIPTION_TYPE: { status: 400, message: "This payment's subscription type isn't one the system knows." },
    ATTENDANCE_REQUIRES_HR: { status: 400, message: "The attendance add-ons need HR: attendance feeds payroll." },
    // The attendance calendar (lib/services/attendance-calendar.service.ts).
    PAYROLL_MONTH_LOCKED: { status: 409, message: "That month's payroll is approved, so its calendar can't change." },
    INVALID_DATE: { status: 400, message: "That isn't a real date." },
    HOURS_NOT_WHOLE_MINUTES: { status: 400, message: "Times must be whole minutes." },
    START_OUT_OF_DAY: { status: 400, message: "A shift must start between 00:00 and 23:59." },
    END_NOT_AFTER_START: { status: 400, message: "A shift must end after it starts." },
    SHIFT_TOO_LONG: { status: 400, message: "A shift can be at most 24 hours." },
    BREAK_TOO_LONG: { status: 400, message: "The break must be shorter than the shift." },
    WORK_WEEK_EMPTY: { status: 400, message: "Choose at least one working day." },
    WORK_WEEK_INVALID_DAY: { status: 400, message: "That isn't a day of the week." },
    WORK_WEEK_DUPLICATE_DAY: { status: 400, message: "Each day can appear only once." },
    SCHEDULE_NAME_REQUIRED: { status: 400, message: "Give the schedule a name." },
    SCHEDULE_NAME_TAKEN: { status: 409, message: "This company already has a schedule with that name." },
    SCHEDULE_NOT_FOUND: { status: 404, message: "Schedule not found." },
    SCHEDULE_ARCHIVED: { status: 400, message: "That schedule has been archived." },
    SCHEDULE_DEFAULT_REQUIRED: { status: 400, message: "Make another schedule the default instead; the company always has one." },
    SCHEDULE_IS_DEFAULT: { status: 400, message: "The default schedule can't be archived. Make another one the default first." },
    SCHEDULE_IN_USE: { status: 409, message: "People are on this schedule now or from a later date. Move them first." },
    VERSION_DATE_TAKEN: { status: 409, message: "This schedule already changes on that date." },
    VERSION_NOT_FOUND: { status: 404, message: "That change of hours wasn't found." },
    LAST_VERSION: { status: 400, message: "A schedule needs hours; it can't lose its only set." },
    OVERRIDE_NAME_REQUIRED: { status: 400, message: "Give the seasonal hours a name." },
    OVERRIDE_ENDS_BEFORE_START: { status: 400, message: "The last day can't be before the first." },
    OVERRIDE_OVERLAPS: { status: 409, message: "Those dates overlap other seasonal hours on this schedule." },
    OVERRIDE_NOT_FOUND: { status: 404, message: "Seasonal hours not found." },
    NOBODY_TO_ASSIGN: { status: 400, message: "Choose at least one person." },
    USER_NOT_IN_COMPANY: { status: 400, message: "Everyone assigned must work for this company." },
    ASSIGNMENT_NOT_FOUND: { status: 404, message: "Assignment not found." },
    HOLIDAY_NAME_REQUIRED: { status: 400, message: "Give the holiday a name." },
    HOLIDAY_DATE_TAKEN: { status: 409, message: "There's already a holiday on that date." },
    HOLIDAY_NOT_FOUND: { status: 404, message: "Holiday not found." },
    SOME_TASKS_NOT_FOUND_OR_ACCESS_DENIED: { status: 403, message: "Some of these tasks don't exist, or aren't yours to pay." },
}

export function knownRefusal(error: unknown) {
    const code = error instanceof Error ? error.message : undefined
    return code && Object.hasOwn(KNOWN_REFUSALS, code) ? KNOWN_REFUSALS[code] : undefined
}
