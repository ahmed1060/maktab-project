import type { TranslationKey } from '@/lib/translations'

/**
 * A day off's type, by name. REGULAR, CASUAL and SICK can be asked for;
 * EMERGENCY and UNPAID are DayOffType values with no form entry yet, kept so
 * a request of either still reads as itself rather than as "Regular".
 */
export const DAY_OFF_TYPE_LABEL: Record<string, TranslationKey> = {
    REGULAR: 'regular_day_off',
    CASUAL: 'casual_day_off',
    SICK: 'sick_day_off',
    EMERGENCY: 'emergency_day_off',
    UNPAID: 'unpaid_day_off',
}

/** The types a person may ask for, in the order the form offers them. */
export const ASKED_DAY_OFF_TYPES = ['REGULAR', 'CASUAL', 'SICK'] as const
export type AskedDayOffType = typeof ASKED_DAY_OFF_TYPES[number]
