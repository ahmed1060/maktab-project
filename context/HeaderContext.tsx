'use client'

import React, { createContext, useContext, useState } from 'react'

type HeaderContextType = {
    title: string | null
    subtitle: string | null
    setTitle: (title: string | null) => void
    setSubtitle: (subtitle: string | null) => void
}

const HeaderContext = createContext<HeaderContextType>({
    title: null,
    subtitle: null,
    setTitle: () => { },
    setSubtitle: () => { }
})

export const HeaderProvider = ({ children }: { children: React.ReactNode }) => {
    const [title, setTitle] = useState<string | null>(null)
    const [subtitle, setSubtitle] = useState<string | null>(null)

    return (
        <HeaderContext.Provider value={{ title, subtitle, setTitle, setSubtitle }}>
            {children}
        </HeaderContext.Provider>
    )
}

export const useHeader = () => useContext(HeaderContext)
