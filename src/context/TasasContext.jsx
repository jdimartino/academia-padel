import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { db } from '../firebase/config'
import { getTasas, setTasas as guardarTasasDoc } from '../firebase/db'
import { hoyISO } from '../lib/fechas'
import {
  TASA_TTL_MS,
  consultarTasasApi,
  esTasaVencida,
  guardarTasasCache,
  leerTasasCache,
  tasasValidas,
} from '../lib/tasas'

/*
 * Tasas BCV compartidas por la app. Se monta una sola vez (App) y resuelve el
 * tenant desde la URL (`/:academia/...`), así el fetch corre "al cargar la app"
 * y todas las pantallas comparten el mismo valor.
 *
 * Orden de respaldo: caché fresca (1 h) → API → caché vencida → última de
 * Firestore (`config/tasas`) → nada. Una tasa MANUAL guardada por el admin
 * siempre gana y no se pisa con la de la API. Nunca bloquea la UI: si todo
 * falla, queda `tasas: null` y las pantallas muestran solo USD.
 */
const TasasContext = createContext(null)

function almacen() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** Tenant activo desde la URL (`/:academia/...`), o null (login, raíz). */
function tenantDeRuta(pathname) {
  const primero = String(pathname ?? '')
    .split('/')
    .filter(Boolean)[0]
  if (!primero || primero === 'login') return null
  return primero
}

export function TasasProvider({ children }) {
  const { pathname } = useLocation()
  const tenantId = tenantDeRuta(pathname)
  const [tasas, setTasas] = useState(null)
  const [fuente, setFuente] = useState(null)
  const [cargando, setCargando] = useState(false)

  const cargar = useCallback(async (tid, { forzar = false } = {}) => {
    // Cede el control antes de tocar el estado para no setearlo de forma
    // síncrona dentro del efecto que dispara la carga.
    await Promise.resolve()
    if (!tid) {
      setTasas(null)
      setFuente(null)
      return
    }
    const storage = almacen()

    // 1) Caché fresca: no se toca la red ni Firestore.
    if (!forzar) {
      const cache = leerTasasCache(storage, Date.now(), TASA_TTL_MS)
      if (cache) {
        setTasas(cache)
        setFuente(cache.fuente ?? null)
        return
      }
    }

    setCargando(true)
    try {
      let guardada = null
      try {
        guardada = await getTasas(db, tid)
      } catch {
        guardada = null
      }

      // 2) Una tasa MANUAL siempre gana: no se pisa con la de la API.
      if (guardada?.fuente === 'manual' && tasasValidas(guardada)) {
        setTasas(guardada)
        setFuente('manual')
        return
      }

      // 3) API (fetch inyectado; null si no está disponible o falla).
      const fetchFn =
        typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null
      const api = await consultarTasasApi(fetchFn)
      if (api) {
        guardarTasasCache(storage, api)
        setTasas(api)
        setFuente('api')
        try {
          await guardarTasasDoc(db, tid, { ...api, fuente: 'api' }, {})
        } catch {
          /* sin permiso (no admin) o sin red: la tasa igual se muestra */
        }
        return
      }

      // 4) Caché vencida (aunque haya pasado el TTL).
      const vencida = leerTasasCache(storage, Date.now(), Number.POSITIVE_INFINITY)
      if (vencida) {
        setTasas(vencida)
        setFuente(vencida.fuente ?? null)
        return
      }

      // 5) Última tasa conocida en Firestore.
      if (guardada && tasasValidas(guardada)) {
        setTasas(guardada)
        setFuente(guardada.fuente ?? null)
        return
      }

      setTasas(null)
      setFuente(null)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar(tenantId)
  }, [tenantId, cargar])

  /** Override manual del admin: guarda en Firestore y en el caché. */
  const guardarManual = useCallback(
    async (bsPorUsd, bsPorEur) => {
      if (!tenantId) throw new Error('Sin academia activa')
      const manual = { bsPorUsd, bsPorEur, fecha: hoyISO(), fuente: 'manual' }
      const normalizado = await guardarTasasDoc(db, tenantId, manual, {})
      guardarTasasCache(almacen(), normalizado)
      setTasas(normalizado)
      setFuente('manual')
      return normalizado
    },
    [tenantId],
  )

  /** Vuelve a la tasa de la API (pisa el override manual). null si la API falla. */
  const restaurarAutomatica = useCallback(async () => {
    if (!tenantId) return null
    const fetchFn =
      typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null
    const api = await consultarTasasApi(fetchFn)
    if (!api) return null
    const normalizado = await guardarTasasDoc(db, tenantId, { ...api, fuente: 'api' }, {})
    guardarTasasCache(almacen(), normalizado)
    setTasas(normalizado)
    setFuente('api')
    return normalizado
  }, [tenantId])

  const vencida = esTasaVencida(tasas)

  const value = useMemo(
    () => ({
      tasas,
      fuente,
      cargando,
      vencida,
      tenantId,
      recargar: () => cargar(tenantId, { forzar: true }),
      guardarManual,
      restaurarAutomatica,
    }),
    [tasas, fuente, cargando, vencida, tenantId, cargar, guardarManual, restaurarAutomatica],
  )

  return <TasasContext.Provider value={value}>{children}</TasasContext.Provider>
}

export function useTasas() {
  const contexto = useContext(TasasContext)
  if (!contexto) throw new Error('useTasas debe usarse dentro de TasasProvider')
  return contexto
}
