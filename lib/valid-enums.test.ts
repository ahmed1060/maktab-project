import { describe, it, expect } from "vitest"
import { isValidTaskStatus, isValidTaskPaymentStatus, VALID_TASK_STATUSES, VALID_TASK_PAYMENT_STATUSES } from "./valid-enums"

describe("isValidTaskStatus / isValidTaskPaymentStatus (F-13)", () => {
    it("accepts every real enum member", () => {
        for (const status of VALID_TASK_STATUSES) {
            expect(isValidTaskStatus(status)).toBe(true)
        }
        for (const status of VALID_TASK_PAYMENT_STATUSES) {
            expect(isValidTaskPaymentStatus(status)).toBe(true)
        }
    })

    it("rejects values that aren't real enum members", () => {
        expect(isValidTaskStatus("SUBMITTED")).toBe(false)
        expect(isValidTaskStatus("pending")).toBe(false) // case-sensitive
        expect(isValidTaskStatus("")).toBe(false)
        expect(isValidTaskPaymentStatus("UNPAID")).toBe(false)
    })

    it("rejects non-string input without throwing", () => {
        expect(isValidTaskStatus(null)).toBe(false)
        expect(isValidTaskStatus(undefined)).toBe(false)
        expect(isValidTaskStatus(42)).toBe(false)
        expect(isValidTaskStatus(["PENDING"])).toBe(false)
    })
})
