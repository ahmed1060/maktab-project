import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { noteSchema } from "@/lib/validations/note.schema"
import { NoteService } from "@/lib/services/note.service"
import { prisma } from "@/lib/prisma"

export const GET = withStandardHandler(async (req, session, _body, { params }) => {
    const { sectionId } = params
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const search = searchParams.get('search') || ''
    const skip = (page - 1) * limit

    try {
        // Auth Check: Verify section belongs to company
        const section = await prisma.businessClientSection.findUnique({
            where: { id: sectionId },
            include: { client: { select: { companyId: true } } }
        })

        if (!section) return ApiResponse.notFound("Section not found")

        if (session.user.role !== 'SUPER_ADMIN') {
            if (section.client.companyId !== session.user.companyId) {
                return ApiResponse.forbidden("Access denied")
            }
        }

        const result = await NoteService.getMany(sectionId, skip, limit, search)
        return ApiResponse.success({
            data: result.notes,
            total: result.total,
            page,
            totalPages: Math.ceil(result.total / limit)
        })
    } catch (error: any) {
        throw error
    }
})

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const { sectionId } = params

    // 1. Validation
    const validation = noteSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Auth Check
        const section = await prisma.businessClientSection.findUnique({
            where: { id: sectionId },
            include: { client: { select: { companyId: true } } }
        })

        if (!section) return ApiResponse.notFound("Section not found")

        if (session.user.role !== 'SUPER_ADMIN') {
            if (section.client.companyId !== session.user.companyId) {
                return ApiResponse.forbidden("Access denied")
            }
        }

        // 3. Service
        const result = await NoteService.create(sectionId, validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        throw error
    }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    const { noteId } = json

    if (!noteId) return ApiResponse.badRequest("Note ID required")

    // 1. Validation
    const validation = noteSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Auth Check
        const note = await prisma.businessClientNote.findUnique({
            where: { id: noteId },
            include: { section: { include: { client: { select: { companyId: true } } } } }
        })

        if (!note) return ApiResponse.notFound("Note not found")

        if (session.user.role !== 'SUPER_ADMIN') {
            if (note.section.client.companyId !== session.user.companyId) {
                return ApiResponse.forbidden("Access denied")
            }
        }

        // 3. Service
        const result = await NoteService.update(noteId, validation.data, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        throw error
    }
})

export const DELETE = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const noteId = searchParams.get('id') || searchParams.get('noteId')

    if (!noteId) return ApiResponse.badRequest("Note ID required")

    try {
        // 1. Auth Check: Super Admin or Admin only
        if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)) {
            return ApiResponse.forbidden("Unauthorized")
        }

        const note = await prisma.businessClientNote.findUnique({
            where: { id: noteId },
            include: { section: { include: { client: { select: { companyId: true } } } } }
        })

        if (!note) return ApiResponse.notFound("Note not found")

        if (session.user.role !== 'SUPER_ADMIN') {
            if (note.section.client.companyId !== session.user.companyId) {
                return ApiResponse.forbidden("Access denied")
            }
        }

        // 2. Service
        await NoteService.delete(noteId)
        return ApiResponse.success({ success: true, id: noteId })
    } catch (error: any) {
        throw error
    }
}, {
    audit: { action: 'DELETE_NOTE', entityType: 'NOTE', getEntityId: (res) => res?.id }
})
