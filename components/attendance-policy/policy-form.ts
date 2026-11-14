import type { TranslationKey } from '@/lib/translations'
import { PERMISSION_TYPES, type DeductionRule, type PolicyBody } from '@/lib/attendance/policy'

/**
 * The attendance policy as its dialog edits it (company settings part 3b):
 * each number as the text typed, so an emptied field is said to be wrong
 * under it, where it used to be sent as 0.
 *
 * A band is edited as where it ends; where it starts follows from the grace
 * and the band before (lib/attendance/policy.ts, bandsProblem).
 */

export type BandForm = { toMinutes: string | null; dayFraction: number }
export type RuleForm = {
    enabled: boolean
    graceMinutes: string
    mode: DeductionRule['mode']
    bands: BandForm[]
    freePerMonth: string
    escalation: { fromOccurrence: string; multiplier: string } | null
    monthlyCapDays: string
}
export type PolicyForm = {
    workWeek: number[]
    lateness: RuleForm
    earlyLeave: RuleForm
    overtime: {
        enabled: boolean
        minimumMinutes: string
        multipliers: { workday: string; restDay: string; holiday: string }
        requiresApproval: boolean
        compensation: PolicyBody['overtime']['compensation']
    }
    absence: { multiplier: number }
    permissionHours: {
        enabled: boolean
        allowanceHours: string
        minPerRequestMinutes: string
        maxPerRequestMinutes: string
        maxRequestsPerMonth: string
        afterTheFactHours: string
        carryOver: PolicyBody['permissionHours']['carryOver']
        types: PolicyBody['permissionHours']['types']
    }
    noCheckInReminderMinutes: number | null
    scanWindowMinutes: string
    departureThresholdMinutes: string
    faceVerificationAvailable: boolean
    faceReverifyMonths: string
}

/** What's wrong with a field: the words, and the range they name. */
export type FieldError = { key: TranslationKey; min?: number; max?: number }
export type FormErrors = Record<string, FieldError>

const text = (n: number | null) => n === null ? '' : String(n)

function ruleForm(rule: DeductionRule): RuleForm {
    return {
        enabled: rule.enabled,
        graceMinutes: text(rule.graceMinutes),
        mode: rule.mode,
        bands: rule.bands.map(b => ({ toMinutes: b.toMinutes === null ? null : text(b.toMinutes), dayFraction: b.dayFraction })),
        freePerMonth: text(rule.freePerMonth),
        escalation: rule.escalation && { fromOccurrence: text(rule.escalation.fromOccurrence), multiplier: text(rule.escalation.multiplier) },
        monthlyCapDays: text(rule.monthlyCapDays),
    }
}

export function formFromBody(body: PolicyBody): PolicyForm {
    const p = body.permissionHours
    return {
        workWeek: [...body.workWeek],
        lateness: ruleForm(body.lateness),
        earlyLeave: ruleForm(body.earlyLeave),
        overtime: {
            enabled: body.overtime.enabled,
            minimumMinutes: text(body.overtime.minimumMinutes),
            multipliers: {
                workday: text(body.overtime.multipliers.workday),
                restDay: text(body.overtime.multipliers.restDay),
                holiday: text(body.overtime.multipliers.holiday),
            },
            requiresApproval: body.overtime.requiresApproval,
            compensation: body.overtime.compensation,
        },
        absence: { multiplier: body.absence.multiplier },
        permissionHours: {
            enabled: p.enabled,
            // Hours, to two places: what a month's minutes come to.
            allowanceHours: text(Math.round(p.monthlyAllowanceMinutes / 60 * 100) / 100),
            minPerRequestMinutes: text(p.minPerRequestMinutes),
            maxPerRequestMinutes: text(p.maxPerRequestMinutes),
            maxRequestsPerMonth: text(p.maxRequestsPerMonth),
            afterTheFactHours: text(p.afterTheFactHours),
            carryOver: p.carryOver,
            types: [...p.types],
        },
        noCheckInReminderMinutes: body.noCheckInReminderMinutes,
        scanWindowMinutes: text(body.scanWindowMinutes),
        departureThresholdMinutes: text(body.departureThresholdMinutes),
        faceVerificationAvailable: body.faceVerificationAvailable,
        faceReverifyMonths: text(body.faceReverifyMonths),
    }
}

const WHOLE = /^\d+$/
const DECIMAL = /^(\d+\.?\d*|\.\d+)$/

/** A typed whole number in range, or null. */
function whole(value: string, min: number, max: number): number | null {
    const v = value.trim()
    if (!WHOLE.test(v)) return null
    const n = Number(v)
    return n >= min && n <= max ? n : null
}

function decimal(value: string, min: number, max: number): number | null {
    const v = value.trim()
    if (!DECIMAL.test(v)) return null
    const n = Number(v)
    return Number.isFinite(n) && n >= min && n <= max ? n : null
}

/** Where each band starts: right after the grace, or after the band before; null until that end is a number. */
export function bandStarts(rule: Pick<RuleForm, 'graceMinutes' | 'bands'>): (number | null)[] {
    const grace = whole(rule.graceMinutes, 0, 24 * 60)
    let from: number | null = grace === null ? null : grace + 1
    return rule.bands.map(b => {
        const start = from
        // An end before its own start doesn't say where the next band starts.
        const end = b.toMinutes === null ? null : whole(b.toMinutes, start ?? 0, 24 * 60)
        from = end === null ? null : end + 1
        return start
    })
}

/** The bands a rule's form says, from its grace on; or the first whose end doesn't read, and the least it could be. */
function readBands(rule: RuleForm, graceMinutes: number): { bands: DeductionRule['bands'] } | { wrong: number; min: number } {
    const bands: DeductionRule['bands'] = []
    let from = graceMinutes + 1
    for (const [i, b] of rule.bands.entries()) {
        if (b.toMinutes === null) {
            bands.push({ fromMinutes: from, toMinutes: null, dayFraction: b.dayFraction })
            from += 1
            continue
        }
        const end = whole(b.toMinutes, from, 24 * 60)
        if (end === null) return { wrong: i, min: from }
        bands.push({ fromMinutes: from, toMinutes: end, dayFraction: b.dayFraction })
        from = end + 1
    }
    return { bands }
}

/**
 * The policy the form says, or what's wrong with it, each under its field
 * (keyed by its place in the policy, "lateness.graceMinutes").
 *
 * A rule switched off isn't charged by, so a field left wrong in it doesn't
 * stop the save: it keeps the number it had in `base`, the version the dialog
 * opened with. The server checks a switched-off rule's numbers too.
 */
export function bodyFromForm(form: PolicyForm, base: PolicyBody): { ok: true; body: PolicyBody } | { ok: false; errors: FormErrors } {
    const errors: FormErrors = {}

    // Each field's range is the policy's own (lib/attendance/policy.ts), so a
    // version the server took saves again unchanged (found by Codex on PR 163).
    /** Checks a field: wrong in a part that's on is an error; in one that's off, the base's number stands. */
    const read = (on: boolean, path: string, value: number | null, fallback: number | null, error: FieldError): number | null => {
        if (value !== null) return value
        if (on) errors[path] = error
        return fallback
    }
    const wholeIn = (on: boolean, path: string, value: string, min: number, max: number, fallback: number) =>
        read(on, path, whole(value, min, max), fallback, { key: 'number_whole_between', min, max }) ?? fallback
    const decimalIn = (on: boolean, path: string, value: string, min: number, max: number, fallback: number) =>
        read(on, path, decimal(value, min, max), fallback, { key: 'number_between', min, max }) ?? fallback
    /** Empty means none. */
    const optionalWhole = (on: boolean, path: string, value: string, min: number, max: number, fallback: number | null) =>
        value.trim() === '' ? null : read(on, path, whole(value, min, max), fallback, { key: 'number_whole_between_or_empty', min, max })
    const optionalDecimal = (on: boolean, path: string, value: string, min: number, max: number, fallback: number | null) =>
        value.trim() === '' ? null : read(on, path, decimal(value, min, max), fallback, { key: 'number_between_or_empty', min, max })

    const rule = (name: 'lateness' | 'earlyLeave'): DeductionRule => {
        const f = form[name], was = base[name], on = f.enabled
        const graceMinutes = wholeIn(on, `${name}.graceMinutes`, f.graceMinutes, 0, 24 * 60, was.graceMinutes)
        // Bands as the form holds them, from the grace on. Charged in bands, an
        // end that isn't a number past its start is wrong; otherwise the
        // version's own bands stand in for ones that don't read.
        const parsed = readBands(f, graceMinutes)
        if ('wrong' in parsed && on && f.mode === 'BANDS') errors[`${name}.bands.${parsed.wrong}`] = { key: 'number_whole_between', min: parsed.min, max: 24 * 60 }
        const bands = 'bands' in parsed ? parsed.bands : was.bands
        return {
            enabled: on,
            graceMinutes,
            mode: f.mode,
            bands,
            freePerMonth: wholeIn(on, `${name}.freePerMonth`, f.freePerMonth, 0, 31, was.freePerMonth),
            escalation: f.escalation && {
                fromOccurrence: wholeIn(on, `${name}.escalation.fromOccurrence`, f.escalation.fromOccurrence, 1, 31, was.escalation?.fromOccurrence ?? 3),
                multiplier: decimalIn(on, `${name}.escalation.multiplier`, f.escalation.multiplier, 1, 5, was.escalation?.multiplier ?? 2),
            },
            monthlyCapDays: optionalDecimal(on, `${name}.monthlyCapDays`, f.monthlyCapDays, 0, 31, was.monthlyCapDays),
        }
    }

    if (form.workWeek.length === 0) errors.workWeek = { key: 'attendance_work_week_empty' }
    const lateness = rule('lateness')
    const earlyLeave = rule('earlyLeave')

    const o = form.overtime, oWas = base.overtime, oOn = o.enabled
    const overtime: PolicyBody['overtime'] = {
        enabled: oOn,
        minimumMinutes: wholeIn(oOn, 'overtime.minimumMinutes', o.minimumMinutes, 0, 24 * 60, oWas.minimumMinutes),
        multipliers: {
            workday: decimalIn(oOn, 'overtime.multipliers.workday', o.multipliers.workday, 1, 5, oWas.multipliers.workday),
            restDay: decimalIn(oOn, 'overtime.multipliers.restDay', o.multipliers.restDay, 1, 5, oWas.multipliers.restDay),
            holiday: decimalIn(oOn, 'overtime.multipliers.holiday', o.multipliers.holiday, 1, 5, oWas.multipliers.holiday),
        },
        requiresApproval: o.requiresApproval,
        compensation: o.compensation,
    }

    const p = form.permissionHours, pWas = base.permissionHours, pOn = p.enabled
    const hours = read(pOn, 'permissionHours.allowanceHours', decimal(p.allowanceHours, 0, 60), null, { key: 'number_between', min: 0, max: 60 })
    let permissionHours: PolicyBody['permissionHours'] = {
        enabled: pOn,
        monthlyAllowanceMinutes: hours === null ? pWas.monthlyAllowanceMinutes : Math.round(hours * 60),
        minPerRequestMinutes: wholeIn(pOn, 'permissionHours.minPerRequestMinutes', p.minPerRequestMinutes, 1, 24 * 60, pWas.minPerRequestMinutes),
        maxPerRequestMinutes: wholeIn(pOn, 'permissionHours.maxPerRequestMinutes', p.maxPerRequestMinutes, 1, 24 * 60, pWas.maxPerRequestMinutes),
        maxRequestsPerMonth: optionalWhole(pOn, 'permissionHours.maxRequestsPerMonth', p.maxRequestsPerMonth, 1, 31, pWas.maxRequestsPerMonth),
        afterTheFactHours: wholeIn(pOn, 'permissionHours.afterTheFactHours', p.afterTheFactHours, 0, 24 * 7, pWas.afterTheFactHours),
        carryOver: p.carryOver,
        types: p.types.length ? [...p.types] : [],
    }
    if (pOn) {
        // What the server would refuse in English (lib/attendance/policy.ts, policyProblem), said under the field.
        const max = 'permissionHours.maxPerRequestMinutes'
        if (!errors['permissionHours.minPerRequestMinutes'] && !errors[max]) {
            if (permissionHours.minPerRequestMinutes > permissionHours.maxPerRequestMinutes) errors[max] = { key: 'attendance_permission_limits_reversed' }
            else if (!errors['permissionHours.allowanceHours'] && permissionHours.monthlyAllowanceMinutes > 0
                && permissionHours.maxPerRequestMinutes > permissionHours.monthlyAllowanceMinutes) errors[max] = { key: 'attendance_permission_over_allowance' }
        }
        if (permissionHours.types.length === 0) errors['permissionHours.types'] = { key: 'attendance_permission_types_empty' }
    } else {
        // Switched off, its limits and kinds still have to hold: the ones it opened with do.
        if (permissionHours.minPerRequestMinutes > permissionHours.maxPerRequestMinutes) {
            permissionHours = { ...permissionHours, minPerRequestMinutes: pWas.minPerRequestMinutes, maxPerRequestMinutes: pWas.maxPerRequestMinutes }
        }
        if (permissionHours.types.length === 0) permissionHours = { ...permissionHours, types: pWas.types.length ? [...pWas.types] : [...PERMISSION_TYPES] }
    }

    // Scans close together count as one (§6.9, PR 273): always read, so always checked.
    const scanWindowMinutes = wholeIn(true, 'scanWindowMinutes', form.scanWindowMinutes, 1, 60, base.scanWindowMinutes)
    // A departure to confirm (§6.9, PR 274): always read, so always checked.
    const departureThresholdMinutes = wholeIn(true, 'departureThresholdMinutes', form.departureThresholdMinutes, 1, 720, base.departureThresholdMinutes)
    const faceReverifyMonths = optionalWhole(form.faceVerificationAvailable, 'faceReverifyMonths', form.faceReverifyMonths, 1, 36, base.faceReverifyMonths)

    if (Object.keys(errors).length > 0) return { ok: false, errors }
    return {
        ok: true,
        body: {
            workWeek: [...form.workWeek],
            lateness,
            earlyLeave,
            overtime,
            absence: { multiplier: form.absence.multiplier },
            permissionHours,
            noCheckInReminderMinutes: form.noCheckInReminderMinutes,
            scanWindowMinutes,
            departureThresholdMinutes,
            faceVerificationAvailable: form.faceVerificationAvailable,
            faceReverifyMonths,
        },
    }
}
