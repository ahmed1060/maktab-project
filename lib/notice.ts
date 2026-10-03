import type { TranslationKey } from "@/lib/translations"

/**
 * A notification's message as a translation key and its details, so it reads
 * in the language of whoever opens the bell, not whoever caused it.
 *
 * Details are what the sentence mentions: a name or a title as written, a
 * number, a date (shown in the reader's format), or another key — a label
 * such as a built-in role, or a part of the sentence that is there only
 * sometimes, such as " Reason: …".
 *
 * Pure, and without the dictionaries: the bell passes its own t(), so neither
 * language is bundled with it (see lib/translations/index.ts). The server's
 * English copy is written by lib/notice-row.ts.
 */

export type NoticeKey = Extract<TranslationKey, `notice_${string}`>

export type NoticeParam =
    | string
    | number
    | { date: string }
    | { key: TranslationKey; params?: Record<string, NoticeParam> }

export type NoticeText = { key: NoticeKey; params?: Record<string, NoticeParam> }

/** A date in the reader's format. Dates are sent as ISO strings. */
export type DateFormat = (iso: string) => string

export function renderNotice(
    text: { key: TranslationKey; params?: Record<string, NoticeParam> },
    t: (key: TranslationKey) => string,
    formatDate: DateFormat,
): string {
    const params = text.params ?? {}
    // One pass: a title that happens to contain "{name}" is shown as written,
    // not filled in.
    return t(text.key).replace(/\{(\w+)\}/g, (whole, name: string) => {
        if (!(name in params)) return whole
        const value = params[name]
        if (typeof value === "string" || typeof value === "number") return String(value)
        if ("date" in value) return formatDate(value.date)
        return renderNotice(value, t, formatDate)
    })
}

/** An optional part of a sentence: the key when there is something to say, nothing otherwise. */
export function optional(key: TranslationKey, params: Record<string, NoticeParam>, when: unknown): NoticeParam {
    return when ? { key, params } : ""
}

const KIND_LABEL = {
    SUPER_ADMIN: "role_super_admin",
    ADMIN: "role_admin",
    TEAM_LEADER: "role_team_leader",
    EMPLOYEE: "role_employee",
} as const satisfies Record<string, TranslationKey>

/** A role by name: a built-in one in the reader's language (lib/role-label.ts), any other as named. */
export function roleParam(role: { name: string; builtIn?: string | null } | null | undefined): NoticeParam {
    if (!role) return ""
    const key = role.builtIn ? KIND_LABEL[role.builtIn as keyof typeof KIND_LABEL] : undefined
    return key ? { key } : role.name
}

/** What kind of account somebody has (User.role), as a word: "Admin", not "ADMIN". */
export function roleKindParam(kind: string): NoticeParam {
    const key = KIND_LABEL[kind as keyof typeof KIND_LABEL]
    return key ? { key } : kind.replace(/_/g, " ")
}
