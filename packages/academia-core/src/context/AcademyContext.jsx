import { createContext, useContext, useMemo } from 'react'
import { DEFAULT_CONFIG, DEFAULT_TOGGLES } from '../config/defaults'

const AcademyContext = createContext({
  config: DEFAULT_CONFIG,
  toggles: DEFAULT_TOGGLES,
})

export function AcademyProvider({ config, toggles, children }) {
  const value = useMemo(
    () => ({
      config: { ...DEFAULT_CONFIG, ...config },
      toggles: { ...DEFAULT_TOGGLES, ...toggles },
    }),
    [config, toggles],
  )
  return <AcademyContext.Provider value={value}>{children}</AcademyContext.Provider>
}

export function useAcademy() {
  return useContext(AcademyContext)
}
