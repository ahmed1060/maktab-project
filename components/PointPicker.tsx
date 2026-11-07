'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import { useLanguage } from '@/context/LanguageContext'
import { Button } from '@/components/ui'
import { cx } from '@/components/ui/cx'
import { hereAttribution, hereProviders, hereTileUrl, LEAFLET_CREDIT, loadHereCopyrights, type HereStyle } from '@/lib/here-tiles'
import { fixStillWanted, formatPoint, locateErrorKey, MAX_ACCURACY_METERS, parsePoint } from '@/lib/attendance/geo'

/**
 * Two more ways to fill a check-in place's "lat, lng" field, beside typing or
 * pasting it: where this device is now, or a pin on a map. Both write the
 * same text into the field, so the field stays the one thing that is saved.
 *
 * The map is HERE's (the same key as the place search), drawn with Leaflet,
 * as a street map or satellite imagery. Clicking puts the pin
 * there; the pin can be dragged; the circle shows the radius. Without a
 * mouse, the arrow keys move the map and "Pin the centre" drops the pin
 * under the cross in the middle.
 *
 * On the building blocks (DESIGN.md §5.3, "A place on the map"): their
 * buttons, its line in a hint's or a problem's colour, and the map's frame
 * in components/ui/ui.css.
 */

const CAIRO: [number, number] = [30.0444, 31.2357]

type Status = { kind: 'accuracy'; meters: number; text: string } | { kind: 'error'; key: ReturnType<typeof locateErrorKey> | 'att_loc_here_unsupported' }

export default function PointPicker({ value, radius, onChange }: {
    value: string
    radius: number
    onChange: (text: string) => void
}) {
    const { t, locale } = useLanguage()
    const hereKey = process.env.NEXT_PUBLIC_HERE_API_KEY
    const [mapOpen, setMapOpen] = useState(false)
    const [locating, setLocating] = useState(false)
    const [status, setStatus] = useState<Status | null>(null)
    const [drawn, setDrawn] = useState(0)

    const box = useRef<HTMLDivElement>(null)
    // `still`: the device asks for reduced motion, so the map moves at once (DESIGN.md §8).
    const leaflet = useRef<{ L: typeof Leaflet; map: Leaflet.Map; still: boolean } | null>(null)
    const pin = useRef<Leaflet.Marker | null>(null)
    // The radius ring, over a wider white one as the pin has a white border,
    // so it shows on satellite imagery as well as the street map, whatever the
    // brand colour (DESIGN.md §2.1). The white one first, so it lies underneath.
    const rings = useRef<Leaflet.Circle[]>([])
    const latest = useRef({ value, onChange })
    useEffect(() => { latest.current = { value, onChange } })
    const alive = useRef(true)
    // Set again on each mount: React may mount, unmount and remount (strict mode).
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

    const put = (lat: number, lng: number) => latest.current.onChange(formatPoint(lat, lng))

    // The latest request for this device's position: a newer one, or a point
    // typed or picked while waiting, makes an earlier answer stale.
    const request = useRef(0)
    // Every change to the field, typed, picked or dragged, counted.
    const edits = useRef(0)
    useEffect(() => { edits.current++ }, [value])

    const locate = () => {
        if (!navigator.geolocation) return setStatus({ kind: 'error', key: 'att_loc_here_unsupported' })
        const asked = { request: ++request.current, edits: edits.current }
        const wanted = () => alive.current && fixStillWanted(asked, { request: request.current, edits: edits.current })
        setLocating(true)
        setStatus(null)
        navigator.geolocation.getCurrentPosition(
            pos => {
                if (!alive.current || asked.request !== request.current) return
                setLocating(false)
                if (!wanted()) return
                const text = formatPoint(pos.coords.latitude, pos.coords.longitude)
                setStatus({ kind: 'accuracy', meters: Math.round(pos.coords.accuracy), text })
                latest.current.onChange(text)
            },
            err => {
                if (!alive.current || asked.request !== request.current) return
                setLocating(false)
                if (!wanted()) return
                setStatus({ kind: 'error', key: locateErrorKey(err.code) })
            },
            // A fresh, satellite-grade fix: an old or network-only one could be far off.
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
        )
    }

    // Draw the map while it's open. Leaflet needs the browser, so it's loaded here.
    useEffect(() => {
        if (!mapOpen) return
        let cancelled = false
        let map: Leaflet.Map | null = null
        import('leaflet').then(mod => {
            const L = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as typeof Leaflet)
            if (cancelled || !box.current) return
            const start = parsePoint(latest.current.value)
            const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            map = L.map(box.current, {
                center: start ? [start.latitude, start.longitude] : CAIRO, zoom: start ? 17 : 11,
                // Its own buttons are named in the page's language (DESIGN.md §5.3), below.
                zoomControl: false,
                // With "reduce motion", it zooms, shows its tiles and stops at once (§8).
                zoomAnimation: !still, fadeAnimation: !still, markerZoomAnimation: !still, inertia: !still,
            })
            L.control.zoom({ zoomInTitle: t('map_zoom_in'), zoomOutTitle: t('map_zoom_out') }).addTo(map)
            const layer = (style: HereStyle) => L.tileLayer(hereTileUrl(style, locale, hereKey!, { sharp: L.Browser.retina }), { maxZoom: 20 })
            const street = layer('map').addTo(map)
            const layers = L.control.layers({ [t('att_loc_layer_map')]: street, [t('att_loc_layer_satellite')]: layer('satellite') }, undefined, { position: 'topright' }).addTo(map)
            // Leaflet names the button that opens them "Layers", with no option to name it otherwise.
            const toggle = layers.getContainer()?.querySelector('.leaflet-control-layers-toggle')
            toggle?.setAttribute('title', t('att_loc_layers'))
            toggle?.setAttribute('aria-label', t('att_loc_layers'))
            map.attributionControl.setPrefix(LEAFLET_CREDIT)
            // HERE's notice names the suppliers for the style, zoom and area showing.
            // HERE alone shows at once, so the map is never without it while the list loads.
            let style: HereStyle = 'map'
            let notice = hereAttribution(new Date().getFullYear())
            map.attributionControl.addAttribution(notice)
            const credit = () => {
                if (!map) return
                const m = map
                loadHereCopyrights(hereKey!).then(list => {
                    if (cancelled || map !== m) return
                    const b = m.getBounds()
                    const view = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }
                    const next = hereAttribution(new Date().getFullYear(), list ? hereProviders(list, style, m.getZoom(), view) : [])
                    if (next === notice) return
                    m.attributionControl.removeAttribution(notice).addAttribution(next)
                    notice = next
                })
            }
            map.on('baselayerchange', e => { style = e.layer === street ? 'map' : 'satellite' })
            map.on('moveend zoomend baselayerchange', credit)
            credit()
            map.on('click', e => put(e.latlng.lat, e.latlng.lng))
            leaflet.current = { L, map, still }
            setDrawn(n => n + 1)
        })
        return () => {
            cancelled = true
            map?.remove()
            leaflet.current = null
            pin.current = null
            rings.current = []
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawn once per opening, in the language it opened in
    }, [mapOpen])

    // Keep the pin and circle on the field's point, however it was set.
    useEffect(() => {
        const lf = leaflet.current
        if (!lf) return
        const p = parsePoint(value)
        if (!p) {
            pin.current?.remove(); pin.current = null
            rings.current.forEach(r => r.remove()); rings.current = []
            return
        }
        const at: [number, number] = [p.latitude, p.longitude]
        if (pin.current) pin.current.setLatLng(at)
        else {
            pin.current = lf.L.marker(at, {
                draggable: true,
                // No stop for the keyboard, which can't move it: the arrows
                // move the map, and "Pin the centre" places it.
                keyboard: false,
                title: t('att_loc_pin'),
                alt: t('att_loc_pin'),
                icon: lf.L.divIcon({ className: 'ui-map-pin', iconSize: [22, 22], iconAnchor: [11, 11] }),
            }).addTo(lf.map)
            pin.current.on('dragend', () => { const ll = pin.current!.getLatLng(); put(ll.lat, ll.lng) })
        }
        if (radius > 0) {
            if (rings.current.length) rings.current.forEach(r => r.setLatLng(at).setRadius(radius))
            else rings.current = [
                lf.L.circle(at, { radius, className: 'ui-map-ring-halo', weight: 4, fill: false, interactive: false }).addTo(lf.map),
                lf.L.circle(at, { radius, className: 'ui-map-ring', weight: 2, fillOpacity: 0.12, interactive: false }).addTo(lf.map),
            ]
        } else { rings.current.forEach(r => r.remove()); rings.current = [] }
        // Typed or found somewhere off screen: bring it into view.
        if (!lf.map.getBounds().contains(at)) lf.map.setView(at, Math.max(lf.map.getZoom(), 16), { animate: !lf.still })
    }, [value, radius, drawn, t])

    const pinCentre = () => {
        const c = leaflet.current?.map.getCenter()
        if (c) put(c.lat, c.lng)
    }

    const shown = status && (status.kind === 'error' || status.text === value) ? status : null
    // Too rough for the radius to tell inside from out.
    const rough = shown?.kind === 'accuracy' && shown.meters > Math.max(MAX_ACCURACY_METERS, radius)
    const problem = shown?.kind === 'error' || rough
    // In the page's digits (DESIGN.md §3.3).
    const meters = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')

    return (
        <div className="ui-point-picker">
            <div className="ui-point-picker-buttons">
                <Button busy={locating} onClick={locate}>{locating ? t('att_loc_here_busy') : t('att_loc_here')}</Button>
                {/* No key, no map: the HERE key is what draws it. */}
                {hereKey && <Button aria-expanded={mapOpen} onClick={() => setMapOpen(o => !o)}>{mapOpen ? t('att_loc_pick_close') : t('att_loc_pick')}</Button>}
            </div>
            <p className={cx(problem ? 'ui-error' : 'ui-hint', 'ui-point-picker-status')} role="status">
                {shown?.kind === 'error' && t(shown.key)}
                {shown?.kind === 'accuracy' && t(rough ? 'att_loc_here_rough' : 'att_loc_here_found').replace('{n}', meters(shown.meters))}
            </p>
            {mapOpen && hereKey && <>
                {/* A map isn't mirrored in Arabic. */}
                <div className="ui-map-frame" dir="ltr">
                    <div ref={box} className="ui-map" role="region" aria-label={t('att_loc_map_label')} />
                    {/* The centre of the map, where "Pin the centre" puts the pin. */}
                    <span aria-hidden="true" className="ui-map-cross" />
                </div>
                <div className="ui-map-actions">
                    <Button onClick={pinCentre}>{t('att_loc_pin_centre')}</Button>
                    <span className="ui-hint">{t('att_loc_pick_hint')}</span>
                </div>
            </>}
        </div>
    )
}
