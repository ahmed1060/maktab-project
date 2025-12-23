const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function run() {
    try {
        const superAdmin = await prisma.superAdmin.findFirst();
        const userAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
        const adminId = superAdmin?.id || userAdmin?.id;

        if (!adminId) {
            console.log('No admin found');
            return;
        }

        await prisma.notification.create({
            data: {
                userId: adminId,
                type: 'SUBSCRIPTION_EXPIRY',
                message: 'DEMO: Subscription for SHSD Tech will expire in 14 days (2026-01-06).',
                relatedId: 'demo-id'
            }
        });
        console.log('Demo notification created for admin:', adminId);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
