import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 1 });
        }

        const { language } = await request.json();
        if (!language || !['en', 'ar'].includes(language)) {
            return NextResponse.json({ error: 'Invalid language' }, { status: 400 });
        }

        const userId = session.user.id;
        const role = session.user.role;

        if (role === 'SUPER_ADMIN') {
            await prisma.superAdmin.update({
                where: { id: userId },
                data: { language }
            });
        } else {
            await prisma.user.update({
                where: { id: userId },
                data: { language }
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error updating language:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
