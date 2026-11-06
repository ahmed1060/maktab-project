/**
 * The templates for the bulk upload of tasks, which the Super Admin keeps
 * (DESIGN.md §5.5, "A file that replaces one"): one workbook for each
 * language, stored as templates/template_<locale>.xlsx, from which each
 * company's own template is made.
 */

export type TemplateLocale = 'en' | 'ar'

/** An Excel workbook, by its name: the picker's filter doesn't hold for a file dropped on it. */
export function isWorkbook(name: string): boolean {
    return /^.+\.xlsx$/i.test(name)
}

/** The one there now, as it was uploaded. */
export function rawTemplateUrl(locale: TemplateLocale): string {
    return `/api/templates/raw?locale=${locale}`
}

/** A company's template, made from the one there now with its own lists. */
export function companyTemplateUrl(locale: TemplateLocale, companyId: string): string {
    return `/api/templates/download?locale=${locale}&companyId=${encodeURIComponent(companyId)}`
}

/** Replaces the template for a language; whether it was taken. */
export async function uploadTemplate(file: File, locale: TemplateLocale): Promise<boolean> {
    const body = new FormData()
    body.append('file', file)
    body.append('locale', locale)
    try {
        const res = await fetch('/api/templates/upload', { method: 'POST', body })
        return res.ok
    } catch {
        return false
    }
}
