import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
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

        // Check user existence.
        // Similar to clients route, we might need to handle Super Admin case if they don't have companyId.
        // However, if we assume sections are strictly under a BusinessClient which has a companyId,
        // we can validate access against the BusinessClient's companyId.

        // Find the client first
        const client = await prisma.businessClient.findUnique({
            where: { id: params.id },
            select: { companyId: true }
        })

        if (!client) {
            return NextResponse.json({ error: 'Client not found' }, { status: 404 })
        }

        // Authorization Rule:
        // 1. If User is SUPER_ADMIN, allow access (or maybe check if client belongs to a specific company they manage? SuperAdmins usually have full access).
        // 2. If User is not Super Admin, they MUST belong to the same company as the client.

        if (user?.role !== 'SUPER_ADMIN') {
            if (!user?.companyId || user.companyId !== client.companyId) {
                return NextResponse.json({ error: 'Access denied' }, { status: 404 }) // 404 to hide existence
            }
        }

        const sections = await prisma.businessClientSection.findMany({
            where: {
                clientId: params.id
            },
            include: {
                _count: { select: { notes: true } }
            },
            orderBy: { createdAt: 'asc' }
        })

        return NextResponse.json(sections)

    } catch (error) {
        console.error('Error fetching sections:', error)
        return NextResponse.json({ error: 'Failed to fetch sections' }, { status: 500 })
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
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

        const client = await prisma.businessClient.findUnique({
            where: { id: params.id },
            select: { companyId: true }
        })

        if (!client) {
            return NextResponse.json({ error: 'Client not found' }, { status: 404 })
        }

        if (user?.role !== 'SUPER_ADMIN') {
            if (!user?.companyId || user.companyId !== client.companyId) {
                return NextResponse.json({ error: 'Access denied' }, { status: 404 })
            }
        }

        const body = await request.json()
        const { title } = body

        if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })

        const section = await prisma.businessClientSection.create({
            data: {
                title,
                clientId: params.id
            }
        })

        return NextResponse.json(section)
    } catch (error) {
        console.error('Error creating section:', error)
        return NextResponse.json({ error: 'Failed to create section' }, { status: 500 })
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions)

        if (!session?.user || (session.user.role !== 'SUPER_ADMIN' && session.user.role !== 'ADMIN')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const sectionId = request.nextUrl.searchParams.get('sectionId') || request.nextUrl.searchParams.get('id')

        if (!sectionId) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 })
        }

        const section = await prisma.businessClientSection.findUnique({
            where: { id: sectionId },
            include: { client: { select: { companyId: true } } }
        })

        if (!section) return NextResponse.json({ error: 'Section not found' }, { status: 404 })

        if (session.user.role !== 'SUPER_ADMIN') {
            if (section.client.companyId !== session.user.companyId) {
                return NextResponse.json({ error: 'Access denied' }, { status: 403 })
            }
        }

        await prisma.businessClientSection.delete({ where: { id: sectionId } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting section:', error)
        return NextResponse.json({ error: 'Failed to delete section' }, { status: 500 })
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions)

        if (!session?.user || (session.user.role !== 'SUPER_ADMIN' && session.user.role !== 'ADMIN' && session.user.role !== 'TEAM_LEADER')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { id, title } = body

        if (!id || !title) {
            return NextResponse.json({ error: 'ID and Title are required' }, { status: 400 })
        }

        const section = await prisma.businessClientSection.findUnique({
            where: { id },
            include: { client: { select: { companyId: true } } }
        })

        if (!section) return NextResponse.json({ error: 'Section not found' }, { status: 404 })

        if (session.user.role !== 'SUPER_ADMIN') {
            if (section.client.companyId !== session.user.companyId) {
                return NextResponse.json({ error: 'Access denied' }, { status: 403 })
            }
        }

        const updatedSection = await prisma.businessClientSection.update({
            where: { id },
            data: { title }
        })

        return NextResponse.json(updatedSection)

    } catch (error) {
        console.error('Error updating section:', error)
        return NextResponse.json({ error: 'Failed to update section' }, { status: 500 })
    }
}
