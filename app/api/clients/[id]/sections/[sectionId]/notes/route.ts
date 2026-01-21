import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { supabase } from "@/lib/storage"

export async function GET(
    request: Request,
    { params }: { params: { id: string, sectionId: string } }
) {
    try {
        const session = await getServerSession(authOptions)
        const userId = (session?.user as any)?.id

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let user = await prisma.user.findUnique({
            where: { id: userId },
            select: { companyId: true, role: true }
        }) as any

        if (!user) {
            const superAdmin = await prisma.superAdmin.findUnique({ where: { id: userId } })
            if (superAdmin) {
                user = { ...superAdmin, role: 'SUPER_ADMIN', companyId: null }
            }
        }

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Verify section ownership via BusinessClient
        const section = await prisma.businessClientSection.findUnique({
            where: { id: params.sectionId },
            include: { client: { select: { companyId: true } } }
        })

        if (!section) {
            return NextResponse.json({ error: 'Section not found' }, { status: 404 })
        }

        // Auth Logic: Super Admin OR Matching Company
        if (user?.role !== 'SUPER_ADMIN') {
            if (!user?.companyId || user.companyId !== section.client.companyId) {
                return NextResponse.json({ error: 'Access denied' }, { status: 404 })
            }
        }

        const { searchParams } = new URL(request.url)
        const page = parseInt(searchParams.get('page') || '1')
        const limit = parseInt(searchParams.get('limit') || '10')
        const search = searchParams.get('search') || ''
        const skip = (page - 1) * limit

        const where: any = {
            sectionId: params.sectionId
        }

        if (search) {
            where.OR = [
                { content: { contains: search, mode: 'insensitive' } },
                {
                    createdBy: {
                        OR: [
                            { firstName: { contains: search, mode: 'insensitive' } },
                            { lastName: { contains: search, mode: 'insensitive' } }
                        ]
                    }
                }
            ]
        }

        const [notes, total] = await Promise.all([
            prisma.businessClientNote.findMany({
                where,
                include: {
                    createdBy: {
                        select: { firstName: true, lastName: true, avatar: true, role: true }
                    },
                    lastEditedBy: {
                        select: { firstName: true, lastName: true, role: true }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                skip,
                take: limit
            }),
            prisma.businessClientNote.count({
                where
            })
        ])

        return NextResponse.json({
            data: notes,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        })

    } catch (error) {
        console.error('Error fetching notes:', error)
        return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
    }
}

export async function POST(
    request: Request,
    { params }: { params: { id: string, sectionId: string } }
) {
    try {
        const session = await getServerSession(authOptions)
        const userId = (session?.user as any)?.id

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let user = await prisma.user.findUnique({
            where: { id: userId },
            select: { companyId: true, role: true }
        }) as any

        if (!user) {
            const superAdmin = await prisma.superAdmin.findUnique({ where: { id: userId } })
            if (superAdmin) {
                user = { ...superAdmin, role: 'SUPER_ADMIN', companyId: null }
            }
        }

        // Verify section ownership via BusinessClient
        const section = await prisma.businessClientSection.findUnique({
            where: { id: params.sectionId },
            include: { client: { select: { companyId: true } } }
        })

        if (!section) {
            return NextResponse.json({ error: 'Section not found' }, { status: 404 })
        }

        if (user?.role !== 'SUPER_ADMIN') {
            if (!user?.companyId || user.companyId !== section.client.companyId) {
                return NextResponse.json({ error: 'Access denied' }, { status: 404 })
            }
        }

        const body = await request.json()
        const { content, attachment, expiryDate, reminderDays } = body

        if (!content) return NextResponse.json({ error: 'Content required' }, { status: 400 })

        // Shadow User Logic: If Super Admin doesn't have a User record, create one to satisfy FK
        if (user.role === 'SUPER_ADMIN' && !user.companyId) {
            // Check if user exists in User table
            const existingShadowUser = await prisma.user.findUnique({ where: { id: userId } })

            if (!existingShadowUser) {
                // Determine a safe email for the shadow user
                // If the Super Admin's email is already in User table (unlikely if IDs differ, but possible), we need a loophole.
                // But we are using the SAME ID. If ID exists, we found it above.
                // If ID doesn't exist, we can try to insert.
                // Email collision check:
                const emailExists = await prisma.user.findUnique({ where: { email: user.email } })

                let shadowEmail = user.email
                if (emailExists) {
                    // Start of a tricky edge case: Email exists but ID does not.
                    // We must use a different email for the shadow user.
                    shadowEmail = `superadmin + ${userId} @system.internal`
                }

                await prisma.user.create({
                    data: {
                        id: userId, // Keep ID consistent
                        firstName: user.firstName,
                        lastName: user.lastName,
                        username: user.username || `system_${userId}`,
                        email: shadowEmail,
                        password: user.password, // hashed
                        avatar: user.avatar,
                        role: 'SUPER_ADMIN', // Storing string directly
                        status: 'ACTIVE',
                        totalDifficultyPoints: 0
                    }
                })
            }
        }

        const note = await prisma.businessClientNote.create({
            data: {
                content,
                sectionId: params.sectionId,
                createdById: userId,
                attachment: Array.isArray(attachment) ? JSON.stringify(attachment) : attachment,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                reminderDays: reminderDays ? parseInt(reminderDays) : null
            }
        })

        return NextResponse.json(note)

    } catch (error) {
        console.error('Error creating note:', error)
        return NextResponse.json({ error: 'Failed to create note', details: String(error) }, { status: 500 })
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string, sectionId: string } }
) {
    try {
        const session = await getServerSession(authOptions)

        if (!session?.user || (session.user.role !== 'SUPER_ADMIN' && session.user.role !== 'ADMIN')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const noteId = request.nextUrl.searchParams.get('noteId') || request.nextUrl.searchParams.get('id')

        if (!noteId) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 })
        }

        const note = await prisma.businessClientNote.findUnique({
            where: { id: noteId },
            include: {
                section: {
                    include: {
                        client: {
                            select: { companyId: true }
                        }
                    }
                }
            }
        })

        if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

        if (session.user.role !== 'SUPER_ADMIN') {
            if (note.section.client.companyId !== session.user.companyId) {
                return NextResponse.json({ error: 'Access denied' }, { status: 403 })
            }
        }

        if (note.attachment) {
            try {
                // Handle both single string and JSON array
                let filesToDelete: string[] = []
                if (note.attachment.startsWith('[')) {
                    try {
                        filesToDelete = JSON.parse(note.attachment)
                    } catch {
                        filesToDelete = [note.attachment]
                    }
                } else {
                    filesToDelete = [note.attachment]
                }

                for (const fileUrl of filesToDelete) {
                    if (!fileUrl) continue
                    // Extract file path from URL (e.g., "notes/filename.ext")
                    const urlParts = fileUrl.split('/app-assets/')
                    if (urlParts.length > 1) {
                        const filePath = urlParts[1]
                        await supabase.storage.from('app-assets').remove([filePath])
                    }
                }
            } catch (storageError) {
                console.error('Failed to delete attachment from storage:', storageError)
            }
        }

        await prisma.businessClientNote.delete({ where: { id: noteId } })

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('Error deleting note:', error)
        return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: { id: string, sectionId: string } }
) {
    try {
        const session = await getServerSession(authOptions)
        const userId = (session?.user as any)?.id

        if (!session?.user || (session.user.role !== 'SUPER_ADMIN' && session.user.role !== 'ADMIN')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { noteId, content, expiryDate, reminderDays } = body

        if (!noteId) return NextResponse.json({ error: 'Note ID required' }, { status: 400 })

        const note = await prisma.businessClientNote.findUnique({
            where: { id: noteId },
            include: {
                section: {
                    include: {
                        client: {
                            select: { companyId: true }
                        }
                    }
                }
            }
        })

        if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

        // Auth Logic: Super Admin OR Matching Company
        if (session.user.role !== 'SUPER_ADMIN') {
            if (note.section.client.companyId !== session.user.companyId) {
                return NextResponse.json({ error: 'Access denied' }, { status: 403 })
            }
        }

        const updatedNote = await prisma.businessClientNote.update({
            where: { id: noteId },
            data: {
                content,
                attachment: Array.isArray(body.attachment) ? JSON.stringify(body.attachment) : body.attachment,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                reminderDays: reminderDays ? parseInt(reminderDays) : null,
                lastEditedById: userId,
                lastEditedAt: new Date()
            }
        })

        return NextResponse.json(updatedNote)

    } catch (error) {
        console.error('Error updating note:', error)
        return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
    }
}
