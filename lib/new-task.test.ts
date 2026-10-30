import { describe, it, expect } from "vitest"
import { firstError } from "./form-errors"
import { TASK_FIELDS } from "./new-task"

/**
 * Create task puts the focus on the first field that's wrong, in the order
 * the fields are in. Its errors were gathered in another order, so the page
 * scrolled to the deadline while the location above it was wrong too.
 */
describe("the first field that's wrong", () => {
    it("is the first in the form's order, whatever order the errors are in", () => {
        expect(firstError({ deadline: "Pick its deadline", locationId: "Pick where it's done" }, TASK_FIELDS)).toBe("locationId")
        expect(firstError({ difficulty: "x", title: "y" }, TASK_FIELDS)).toBe("title")
    })

    it("skips an error cleared since, and is none when nothing's wrong", () => {
        expect(firstError({ title: "", assigneeIds: "Pick someone" }, TASK_FIELDS)).toBe("assigneeIds")
        expect(firstError({}, TASK_FIELDS)).toBeNull()
    })
})
