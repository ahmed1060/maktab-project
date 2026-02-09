import { NextResponse } from "next/server"

/**
 * ApiResponse
 * 
 * Standardizes the structure of API responses across the application.
 * Returns: { success: boolean, data?: any, error?: string, details?: any }
 */
export class ApiResponse {
    static success(data: any, status = 200) {
        return NextResponse.json({ success: true, data }, { status })
    }

    static error(message: string, status = 500) {
        return NextResponse.json({ success: false, error: message }, { status })
    }

    static badRequest(message: string, details?: any) {
        return NextResponse.json({
            success: false,
            error: message,
            details
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
