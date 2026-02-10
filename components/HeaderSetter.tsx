'use client'

import { useEffect } from 'react'
import { useHeader } from '@/context/HeaderContext'

interface HeaderSetterProps {
    title: string | null
    subtitle?: string | null
}

export default function HeaderSetter({ title, subtitle }: HeaderSetterProps) {
    const { setTitle, setSubtitle } = useHeader()

    useEffect(() => {
        setTitle(title)
        if (subtitle !== undefined) {
            setSubtitle(subtitle)
        }

        return () => {
            // Optional: reset on unmount if needed, but often pages override each other
        }
    }, [title, subtitle, setTitle, setSubtitle])

    return null
}
