'use client'

import { useLanguage } from '@/context/LanguageContext'
import { Field, TextInput } from '@/components/ui'
import PointPicker from '@/components/PointPicker'
import { LOCATION_NAME_MAX, LOCATION_RADIUS_MAX, LOCATION_RADIUS_MIN } from '@/lib/locations'
import type { PlaceDraft, PlaceErrors } from '@/lib/place-draft'
import PlaceSearch from './PlaceSearch'

/**
 * A place on the map (DESIGN.md §5.3): its name, a place search that drops
 * the pin, the pin itself with "Use my current location" and "Pick on the
 * map" right below it, and its check radius. The same map as the check-in
 * places.
 *
 * The check radius is the location's own form's alone (LATER_CHANGES_PLAN.md
 * §7.22): a client's form has its HQ's name and pin, with no circle. Left
 * empty, it's the system's distance, as the server sends it to whoever may
 * add or edit locations; until it's known, the hint says only the range.
 */
export default function PlaceFields({ draft, onChange, errors, nameLabel, nameHint, disabled = false, locked = false, withRadius = true, defaultRadius }: {
    draft: PlaceDraft
    onChange: (draft: PlaceDraft) => void
    /** Shown once a save has been tried. */
    errors: PlaceErrors
    nameLabel?: string
    nameHint?: string
    disabled?: boolean
    /** Shown as it is, for someone who may not change it: no place search or map either. */
    locked?: boolean
    /** Its check radius and the circle: the location's own form's, not a client's. */
    withRadius?: boolean
    /** The radius left empty takes: the system's distance, once it's known. */
    defaultRadius?: number
}) {
    const { t, locale } = useLanguage()
    const set = (change: Partial<PlaceDraft>) => onChange({ ...draft, ...change })
    // The circle: the radius typed, or the default while it's empty; none without a radius.
    const radius = withRadius ? Number(draft.radius) || defaultRadius || 0 : 0
    const off = disabled || locked
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')

    return (
        <>
            {/* Names keep their own direction, whichever language the page is in (DESIGN.md §7). */}
            <Field
                label={nameLabel ?? t('location_name')}
                hint={nameHint ?? t('location_name_hint')}
                error={errors.name && t('location_name_required')}
            >{p => <TextInput {...p} name="locationName" autoComplete="off" dir="auto" maxLength={LOCATION_NAME_MAX} value={draft.name} onChange={e => set({ name: e.target.value })} disabled={off} />}</Field>
            {/* A place picked from the search drops the pin there, and names a place that has no name yet. */}
            {!locked && <Field label={t('location_search')}>{p => <PlaceSearch {...p} placeholder={t('location_search_placeholder')} onPick={place => set({ point: place.point, name: draft.name.trim() ? draft.name : place.name })} />}</Field>}
            {/* The pin, with its buttons right below it. */}
            <div className="ui-field">
                <Field
                    label={t('location_pin')}
                    // It points to the buttons, which a locked place doesn't have.
                    hint={locked ? undefined : t('att_loc_point_hint')}
                    error={errors.point === 'required' ? t('location_pin_required') : errors.point === 'invalid' ? t('att_loc_point_invalid') : undefined}
                >{p => (
                    <TextInput {...p} name="pin" autoComplete="off" dir="ltr" inputMode="decimal" placeholder="30.0444, 31.2357" value={draft.point} onChange={e => set({ point: e.target.value })} disabled={off} />
                )}</Field>
                {!locked && <PointPicker value={draft.point} radius={radius} onChange={point => set({ point })} />}
            </div>
            {withRadius && (
                <Field
                    label={t('location_radius')}
                    hint={defaultRadius !== undefined ? t('location_radius_hint').replace('{n}', num(defaultRadius)) : t('location_radius_hint_range')}
                    error={errors.radius && t('location_radius_invalid')}
                >{p => (
                    <TextInput {...p} name="radius" autoComplete="off" type="number" inputMode="numeric" min={LOCATION_RADIUS_MIN} max={LOCATION_RADIUS_MAX} step={10} placeholder={defaultRadius !== undefined ? String(defaultRadius) : undefined} value={draft.radius} onChange={e => set({ radius: e.target.value })} disabled={off} />
                )}</Field>
            )}
        </>
    )
}
