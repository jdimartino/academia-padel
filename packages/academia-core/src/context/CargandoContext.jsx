import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import BarraProgreso from '../components/BarraProgreso'

const CargandoContext = createContext(null)

/*
 * CargandoContext: contador global de cargas de datos. Las pantallas que leen
 * de db.js llaman `iniciar()` al empezar y `terminar()` al acabar (siempre, con
 * try/finally). La barra de progreso superior se muestra sola si la carga pasa
 * el retraso (ver src/components/BarraProgreso.jsx).
 */
export function CargandoProvider({ children }) {
  const [pendientes, setPendientes] = useState(0)

  const iniciar = useCallback(() => setPendientes((n) => n + 1), [])
  const terminar = useCallback(() => setPendientes((n) => Math.max(0, n - 1)), [])

  const activo = pendientes > 0
  const valor = useMemo(() => ({ iniciar, terminar, activo }), [activo, iniciar, terminar])

  return (
    <CargandoContext.Provider value={valor}>
      {children}
      <BarraProgreso activo={activo} />
    </CargandoContext.Provider>
  )
}

export function useCargando() {
  const context = useContext(CargandoContext)
  if (!context) {
    throw new Error('useCargando debe usarse dentro de <CargandoProvider>')
  }
  return context
}

export default CargandoContext
