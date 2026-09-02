import { generateSecret, generateURI, verify } from 'otplib'
import QRCode from 'qrcode'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { encryptMfaSecret, decryptMfaSecret } from '@/lib/mfa-crypto'

const ISSUER = 'Maktab'
// otplib's default is 0 — only the exact current 30s window. A little
// slack each direction is standard practice (phone/server clocks drift a
// few seconds without anyone noticing) without meaningfully widening the
// guessing window, since it's still only ever 3 codes total (past,
// current, next) rather than an open-ended range.
const VERIFY_TOLERANCE_SECONDS = 30

type Owner = { userId?: string; superAdminId?: string }

export class MfaService {
    /**
     * Generates a fresh secret and its QR code. Nothing is persisted yet —
     * the account's real mfaSecret only gets written once confirmEnrollment
     * proves a code from this exact secret works, so a botched scan or an
     * abandoned enrollment never leaves an account half-configured.
     */
    static async startEnrollment(accountEmail: string): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
        const secret = generateSecret()
        const otpauthUrl = generateURI({ issuer: ISSUER, label: accountEmail, secret })
        const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl)
        return { secret, otpauthUrl, qrCodeDataUrl }
    }

    static async verifyCode(secret: string, code: string): Promise<boolean> {
        const result = await verify({ secret, token: code, epochTolerance: VERIFY_TOLERANCE_SECONDS })
        return result.valid
    }

    /** Used at login (Phase 5) against the encrypted secret already on file. */
    static async verifyStoredCode(encryptedSecret: string, code: string): Promise<boolean> {
        const secret = decryptMfaSecret(encryptedSecret)
        return this.verifyCode(secret, code)
    }

    static async confirmEnrollment(owner: Owner, secret: string, code: string): Promise<void> {
        const ok = await this.verifyCode(secret, code)
        if (!ok) throw new Error('INVALID_CODE')

        const encrypted = encryptMfaSecret(secret)
        if (owner.superAdminId) {
            await prisma.superAdmin.update({ where: { id: owner.superAdminId }, data: { mfaSecret: encrypted, mfaEnabled: true } })
        } else if (owner.userId) {
            await prisma.user.update({ where: { id: owner.userId }, data: { mfaSecret: encrypted, mfaEnabled: true } })
        }
    }

    /**
     * Disabling requires re-entering the account's own password — the same
     * "prove it's really you" bar the change-password flow already uses.
     * A protected SuperAdmin is blocked from ever reaching this at the
     * route level (see /api/account/mfa/disable) — this method doesn't
     * re-check isProtected itself, since by the time a caller has an
     * owner here it's already been through that gate.
     */
    static async disable(owner: Owner, password: string): Promise<void> {
        if (owner.superAdminId) {
            const admin = await prisma.superAdmin.findUnique({ where: { id: owner.superAdminId } })
            if (!admin) throw new Error('NOT_FOUND')
            if (!(await bcrypt.compare(password, admin.password))) throw new Error('INVALID_PASSWORD')
            await prisma.superAdmin.update({ where: { id: owner.superAdminId }, data: { mfaSecret: null, mfaEnabled: false } })
        } else if (owner.userId) {
            const user = await prisma.user.findUnique({ where: { id: owner.userId } })
            if (!user) throw new Error('NOT_FOUND')
            if (!(await bcrypt.compare(password, user.password))) throw new Error('INVALID_PASSWORD')
            await prisma.user.update({ where: { id: owner.userId }, data: { mfaSecret: null, mfaEnabled: false } })
        }
    }
}
