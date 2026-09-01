import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

/**
 * Recursively converts any Prisma.Decimal instance to a plain number.
 *
 * Decimal.toJSON() returns a *string* (decimal.js's own deliberate choice,
 * to stop silent precision loss elsewhere) — so a Decimal field surviving
 * into a JSON response would silently switch that field's wire type from
 * number to string, breaking any frontend arithmetic or .toFixed() call on
 * it. F-07 turned several money/payroll-day fields (User.salary,
 * Task.totalCost, SalaryRecord.*, SalaryAdjustment.amount,
 * CompanyPayment.cost) from Float into Decimal — this walks arbitrary
 * response data (including nested objects, relations, and arrays of
 * either) and fixes it before NextResponse.json() serializes it, so every
 * route gets this for free rather than needing its own conversion.
 *
 * Uses Prisma.Decimal.isDecimal(), not `instanceof` or duck-typing —
 * decimal.js's built-in check. (A constructor-name check was tried first
 * and silently failed: the bundled Prisma runtime minifies the Decimal
 * class, so `value.constructor.name` is not the string "Decimal" — caught
 * by the tests in api-response.test.ts, which is why this exists.)
 */
function isDecimal(value: any): boolean {
    return Prisma.Decimal.isDecimal(value)
}

function normalizeDecimals(value: any, seen: WeakSet<object> = new WeakSet()): any {
    if (isDecimal(value)) return value.toNumber()
    if (value instanceof Date) return value
    if (Array.isArray(value)) return value.map(v => normalizeDecimals(v, seen))
    if (value !== null && typeof value === 'object') {
        // Guard against circular references and non-plain objects (anything
        // that isn't a Decimal, Date, array, or plain object is returned
        // as-is rather than risk mangling it via Object.keys).
        if (seen.has(value)) return value
        if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value
        seen.add(value)
        const out: Record<string, any> = {}
        for (const key of Object.keys(value)) {
            out[key] = normalizeDecimals(value[key], seen)
        }
        return out
    }
    return value
}

/**
 * ApiResponse
 *
 * Standardizes the structure of API responses across the application.
 * Returns: { success: boolean, data?: any, error?: string, details?: any }
 */
export class ApiResponse {
    static success(data: any, status = 200) {
        return NextResponse.json({ success: true, data: normalizeDecimals(data) }, { status })
    }

    static error(message: string, status = 500) {
        return NextResponse.json({ success: false, error: message }, { status })
    }

    static badRequest(message: string, details?: any) {
        return NextResponse.json({
            success: false,
            error: message,
            details: normalizeDecimals(details)
        }, { status: 400 })
    }

    static unauthorized(message = "Unauthorized") {
        return NextResponse.json({ success: false, error: message }, { status: 401 })
    }

    static forbidden(message = "Forbidden") {
        return NextResponse.json({ success: false, error: message }, { status: 403 })
    }

    static notFound(message = "Not Found") {
        return NextResponse.json({ success: false, error: message }, { status: 404 })
    }
}
