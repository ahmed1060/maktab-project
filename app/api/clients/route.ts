import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

// Helper to get user session (mocked for now, assumes middleware handles auth/headers)
// In a real app with next-auth, you'd use getServerSession
// Here we rely on the implementation pattern seen elsewhere (or standard header extraction if applicable)
// BUT, based on the codebase history, it seems we often pass user ID via headers or assume session.
// Wait, looking at other routes (e.g. tasks), we often query the DB using the user ID.

// Let's stick to the pattern of checking headers for userId if that's how it's done,
// OR more reliably, let's assume we can get the logged in user from `headers().get('x-user-id')` if using custom middleware,
// or just use standard payload parsing if this project uses JWTs directly in routes.

// However, looking at `api / users / route.ts` or `api / tasks / route.ts` would be best.
// I'll assume standard robust pattern:

export async function GET() {
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
            return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        if (!user.companyId && user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'User not assigned to a company' }, { status: 404 })
        }

        const where: any = {}
        if (user.role !== 'SUPER_ADMIN') {
            where.companyId = user.companyId
        }

        const clients = await prisma.businessClient.findMany({
            where,
            orderBy: {
                createdAt: 'desc'
            },
            include: {
                createdBy: {
                    select: { firstName: true, lastName: true, role: true }
                },
                lastEditedBy: {
                    select: { firstName: true, lastName: true, role: true }
                },
                _count: {
                    select: { sections: true }
                }
            }
        })

        return NextResponse.json(clients)

    } catch (error) {
        console.error('Error fetching clients:', error)
        return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    console.log('[API] POST /api/clients started')
    try {
        const session = await getServerSession(authOptions)
        console.log('[API] Session:', session ? 'Found' : 'Null')

        const userId = (session?.user as any)?.id
        console.log('[API] UserId:', userId)

        if (!userId) {
            console.log('[API] Unauthorized: No UserId')
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let user = await prisma.user.findUnique({
            where: { id: userId },
            select: { companyId: true, role: true }
        }) as any

        if (!user) {
            // Check SuperAdmin table
            const superAdmin = await prisma.superAdmin.findUnique({
                where: { id: userId }
            })
            if (superAdmin) {
                user = { ...superAdmin, role: 'SUPER_ADMIN', companyId: null }
            }
        }
        console.log('[API] User Fetch Result:', user)

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        const body = await request.json()
        console.log('[API] Body:', body)
        const { name, companyId } = body

        if (!name) {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 })
        }

        // Determine target company ID
        let targetCompanyId = user?.companyId

        if (user?.role === 'SUPER_ADMIN') {
            if (companyId) {
                targetCompanyId = companyId
            } else if (!targetCompanyId) {
                return NextResponse.json({ error: 'Company Selection Required', details: 'As a Super Admin, you must select a company to create a client for.' }, { status: 400 })
            }
        } else {
            // Regular users must have a company
            if (!targetCompanyId) {
                return NextResponse.json({ error: 'User not assigned to a company' }, { status: 404 })
            }
            // Logic to prevent regular users from passing a different companyId is implicit (we ignore body.companyId)
        }

        const client = await prisma.businessClient.create({
            data: {
                name,
                companyId: targetCompanyId!,
                createdById: userId
            }
        })
        console.log('[API] Client Created:', client)

        return NextResponse.json(client)

    } catch (error) {
        console.error('[API] Error creating client:', error)
        return NextResponse.json({ error: 'Failed to create client', details: String(error) }, { status: 500 })
    }
}

export async function DELETE(request: Request) {
    try {
        const session = await getServerSession(authOptions)

        if (!session?.user || (session.user.role !== 'SUPER_ADMIN' && session.user.role !== 'ADMIN')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const id = searchParams.get('id')

        if (!id) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 })
        }

        const client = await prisma.businessClient.findUnique({ where: { id } })
        if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

        if (session.user.role !== 'SUPER_ADMIN') {
            if (client.companyId !== session.user.companyId) {
                return NextResponse.json({ error: 'Access denied' }, { status: 403 })
            }
        }

        await prisma.businessClient.delete({ where: { id } })

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('Error deleting client:', error)
        return NextResponse.json({ error: 'Failed to delete client' }, { status: 500 })
    }
}

export async function PUT(request: Request) {
    try {
        const session = await getServerSession(authOptions)
        const userId = (session?.user as any)?.id

        if (!userId || !session?.user || (session.user.role !== 'SUPER_ADMIN' && session.user.role !== 'ADMIN' && session.user.role !== 'TEAM_LEADER')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { id, name } = body

        if (!id || !name) {
            return NextResponse.json({ error: 'ID and Name are required' }, { status: 400 })
        }

        const client = await prisma.businessClient.findUnique({ where: { id } })
        if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

        if (session.user.role !== 'SUPER_ADMIN') {
            if (client.companyId !== session.user.companyId) {
                return NextResponse.json({ error: 'Access denied' }, { status: 403 })
            }
        }

        const updatedClient = await prisma.businessClient.update({
            where: { id },
            data: {
                name,
                lastEditedById: userId
            }
        })

        return NextResponse.json(updatedClient)

    } catch (error) {
        console.error('Error updating client:', error)
        return NextResponse.json({ error: 'Failed to update client' }, { status: 500 })
    }
}
