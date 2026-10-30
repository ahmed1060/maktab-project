'use client'

import { ListBulletsIcon, MapPinIcon, StorefrontIcon } from '@phosphor-icons/react/ssr'
import { Field, Select, type PhosphorIcon } from '@/components/ui'
import type { ExtraFilter } from '@/components/locations/usePlaceFilters'
import { optionsOf } from './extra-filters'

const ICONS: Record<string, PhosphorIcon> = { clientId: StorefrontIcon, locationId: MapPinIcon, costNameId: ListBulletsIcon, titleNameId: ListBulletsIcon }

/**
 * The client, location and saved name filters (usePlaceFilters,
 * useNameFilter) as the filter bar's selects (DESIGN.md §5.3). A hidden
 * one, set by a shared link for someone who can't pick it, has no select:
 * it's counted with the rest, and Reset clears it.
 */
export default function ExtraFilterSelects({ filters, onPick }: { filters: ExtraFilter[]; onPick: (key: string, value: string) => void }) {
    const picked = Object.fromEntries(filters.map(f => [f.key, f.value]))
    return (
        <>
            {filters.filter(f => !f.hidden).map(f => (
                <Field key={f.key} label={f.label} hideLabel>{p => (
                    <Select {...p} icon={ICONS[f.key]} value={f.value} onChange={e => onPick(f.key, e.target.value)} options={optionsOf(f, picked)} />
                )}</Field>
            ))}
        </>
    )
}
