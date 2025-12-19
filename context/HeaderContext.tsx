'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'

type HeaderContextType = {
    title: string | null
    setTitle: (title: string | null) => void
}

const HeaderContext = createContext<HeaderContextType>({
    title: null,
    setTitle: () => { }
})

export const HeaderProvider = ({ children }: { children: React.ReactNode }) => {
    const [title, setTitle] = useState<string | null>(null)

    return (
        <HeaderContext.Provider value={{ title, setTitle }}>
            {children}
        </HeaderContext.Provider>
    )
}

export const useHeader = () => useContext(HeaderContext)
