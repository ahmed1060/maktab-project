import { withStandardHandler } from "@/lib/api-utils"
import { RateLimiter } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"

export const POST = withStandardHandler(
    async (req, session, body) => {
        const { identifier, type } = body

        if (!identifier) {
            return ApiResponse.error("Identifier is required")
        }

        // type can be 'IP' or 'USER' or 'PREFIX'
        // For login, the key is `login:${ip}`
        // For API routes, the key is `${userId || ip}:${action}`

        if (type === 'LOGIN_IP') {
            RateLimiter.clear(`login:${identifier}`)
        } else if (type === 'USER_ALL') {
            RateLimiter.clearByPrefix(`${identifier}:`)
        } else if (type === 'IP_ALL') {
            RateLimiter.clearByPrefix(`${identifier}:`)
        } else {
            // General fallback: clear exact key if provided, or clear by prefix
            RateLimiter.clear(identifier)
            RateLimiter.clearByPrefix(identifier)
        }

        // Audit Log
        await prisma.auditLog.create({
            data: {
                action: 'ADMIN_UNBLOCK_RATE_LIMIT',
                entityType: 'SYSTEM',
                entityId: identifier,
                superAdminId: session.user.id,
                details: { identifier, type }
            }
        })

        return ApiResponse.success({ message: "Rate limit cleared successfully" })
    },
    {
        allowedRoles: ['SUPER_ADMIN']
    }
)
