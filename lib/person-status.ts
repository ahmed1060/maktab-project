import type { StatusTone } from '@/components/ui/StatusBadge'
import type { TranslationKey } from '@/lib/translations'

/**
 * A person's status in words and its meaning's colour (DESIGN.md §2.3), one
 * place for the lists that show it, the Employees list and the Super Admin's
 * All users (part 3c), so the two can't say it differently.
 */
export const STATUS_TONE: Record<string, StatusTone> = { ACTIVE: 'good', OFFLINE: 'neutral', SUSPENDED: 'problem', ARCHIVED: 'neutral' }
export const STATUS_WORD: Record<string, TranslationKey> = { ACTIVE: 'status_online', OFFLINE: 'status_offline', SUSPENDED: 'status_suspended', ARCHIVED: 'status_archived' }
