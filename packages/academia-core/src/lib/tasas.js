/*
 * Tasas: lógica PURA de la tasa BCV (Bs por USD y Bs por EUR). Sin React y sin
 * red: el `fetch` se INYECTA desde quien la usa (`consultarTasasApi(fetchFn)`),
 * así los tests nunca salen a la red. Acá viven el parseo/normalización de la
 * respuesta, las conversiones de centavos USD a Bs/EUR, el formateo es-VE, el
 * vencimiento y el caché (con el storage inyectado).
 *
 * Los montos SIEMPRE son enteros de centavos de USD (src/lib/dinero.js). Las
 * conversiones son solo para MOSTRAR: nunca se guarda un monto en Bs/EUR.
 */

/*
 * Endpoints públicos de la API BCV (DolarApi): sirve la tasa oficial del BCV de
 * dólar y euro, no pide key y manda `access-control-allow-origin: *`. Todo el
 * contrato con la API vive en esta constante.
 */
export const TASAS_API = Object.freeze({
  usd: 'https://ve.dolarapi.com/v1/dolares/oficial',
  eur: 'https://ve.dolarapi.com/v1/euros/oficial',
})

/** Clave de localStorage del caché de tasas. */
export const TASAS_CACHE_CLAVE = 'academia-padel.tasas'

/** TTL del caché: 1 hora. Pasado ese tiempo se vuelve a consultar la API. */
export const TASA_TTL_MS = 60 * 60 * 1000

/** A partir de acá una tasa mostrada se considera "desactualizada" (24 h). */
export const TASA_VENCIDA_MS = 24 * 60 * 60 * 1000

/** Fuentes válidas de una tasa guardada en Firestore (`config/tasas`). */
export const FUENTES_TASA = ['api', 'manual']

/** Tope sano de Bs por unidad: evita guardar basura de la API. */
export const LIMITE_BS_POR_UNIDAD = 100000000

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Normaliza una fecha (ISO/Date/"YYYY-MM-DD") a "YYYY-MM-DD"; null si no sirve. */
export function normalizarFechaTasa(valor) {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10)
  }
  if (typeof valor !== 'string') return null
  const texto = valor.trim()
  if (RE_FECHA.test(texto)) return texto
  const corte = texto.slice(0, 10)
  return RE_FECHA.test(corte) ? corte : null
}

/**
 * Bs por unidad desde una respuesta de la API. Prefiere `promedio` (el valor de
 * referencia del BCV) y cae a `venta`/`compra`. Devuelve null si no hay un
 * número finito > 0.
 */
export function normalizarTasaRespuesta(respuesta) {
  if (!respuesta || typeof respuesta !== 'object') return null
  for (const clave of ['promedio', 'venta', 'compra']) {
    const valor = respuesta[clave]
    if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) return valor
  }
  return null
}

/** ¿La tasa tiene ambos Bs por unidad finitos y positivos? */
export function tasasValidas(tasas) {
  return (
    tasas != null &&
    typeof tasas === 'object' &&
    typeof tasas.bsPorUsd === 'number' &&
    Number.isFinite(tasas.bsPorUsd) &&
    tasas.bsPorUsd > 0 &&
    typeof tasas.bsPorEur === 'number' &&
    Number.isFinite(tasas.bsPorEur) &&
    tasas.bsPorEur > 0
  )
}

/**
 * Construye las tasas normalizadas a partir de las dos respuestas de la API
 * (USD y EUR). Devuelve null si a alguna le falta el número. `fuente` es
 * siempre `'api'`; `obtenidoEn` (ms) es solo para el caché/vencimiento.
 */
export function construirTasasApi(respuestaUsd, respuestaEur, ahora = new Date()) {
  const bsPorUsd = normalizarTasaRespuesta(respuestaUsd)
  const bsPorEur = normalizarTasaRespuesta(respuestaEur)
  if (bsPorUsd == null || bsPorEur == null) return null
  const fecha =
    normalizarFechaTasa(respuestaUsd?.fechaActualizacion) ??
    normalizarFechaTasa(respuestaEur?.fechaActualizacion) ??
    normalizarFechaTasa(ahora)
  return { bsPorUsd, bsPorEur, fecha, fuente: 'api', obtenidoEn: ahora.getTime() }
}

/**
 * Consulta la API con el `fetch` INYECTADO. No usa ningún fetch global: si no
 * se pasa una función, devuelve null. Nunca lanza: cualquier error de red,
 * CORS o JSON se traduce en null (para caer al respaldo).
 */
export async function consultarTasasApi(fetchFn, { signal, ahora } = {}) {
  if (typeof fetchFn !== 'function') return null
  const ahoraFecha = ahora instanceof Date ? ahora : new Date(ahora ?? Date.now())
  try {
    const [resUsd, resEur] = await Promise.all([
      fetchFn(TASAS_API.usd, { signal }),
      fetchFn(TASAS_API.eur, { signal }),
    ])
    if (!resUsd?.ok || !resEur?.ok) return null
    const [dataUsd, dataEur] = await Promise.all([resUsd.json(), resEur.json()])
    return construirTasasApi(dataUsd, dataEur, ahoraFecha)
  } catch {
    return null
  }
}

/** Centavos de USD → Bs. null si la entrada no sirve. */
export function usdCentsABS(cents, bsPorUsd) {
  if (!Number.isInteger(cents) || cents < 0 || !Number.isFinite(bsPorUsd) || bsPorUsd <= 0) {
    return null
  }
  return (cents / 100) * bsPorUsd
}

/** Centavos de USD → EUR (vía Bs: USD→Bs→EUR). null si la entrada no sirve. */
export function usdCentsAEur(cents, bsPorUsd, bsPorEur) {
  if (
    !Number.isInteger(cents) ||
    cents < 0 ||
    !Number.isFinite(bsPorUsd) ||
    !Number.isFinite(bsPorEur) ||
    bsPorUsd <= 0 ||
    bsPorEur <= 0
  ) {
    return null
  }
  return (cents / 100) * (bsPorUsd / bsPorEur)
}

/** Número con separadores es-VE y N decimales; '' si no es finito. */
export function formatearNumeroEsVE(valor, decimales = 2) {
  if (!Number.isFinite(valor)) return ''
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valor)
}

/** "Bs 4.395,61". */
export function formatearBs(valor) {
  const numero = formatearNumeroEsVE(valor)
  return numero ? `Bs ${numero}` : ''
}

/** "€ 5,12". */
export function formatearEur(valor) {
  const numero = formatearNumeroEsVE(valor)
  return numero ? `€ ${numero}` : ''
}

/** Etiqueta legible de la fuente de la tasa. */
export function etiquetaFuente(fuente) {
  if (fuente === 'api') return 'API BCV'
  if (fuente === 'manual') return 'Manual'
  return 'Sin tasa'
}

/** Momento de referencia (ms) de una tasa: obtenidoEn/guardadoEn/actualizadoEn/fecha. */
export function momentoDeTasa(tasas) {
  if (!tasas) return null
  for (const clave of ['obtenidoEn', 'guardadoEn', 'actualizadoEn']) {
    const valor = tasas[clave]
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.getTime()
    if (valor && typeof valor.toMillis === 'function') return valor.toMillis()
    if (typeof valor === 'string') {
      const ms = Date.parse(valor)
      if (!Number.isNaN(ms)) return ms
    }
  }
  const fecha = normalizarFechaTasa(tasas.fecha)
  if (fecha) {
    const ms = Date.parse(`${fecha}T00:00:00`)
    if (!Number.isNaN(ms)) return ms
  }
  return null
}

/** ¿La tasa está desactualizada? Sin tasa o sin referencia → true. */
export function esTasaVencida(tasas, ahora = Date.now(), vencidaMs = TASA_VENCIDA_MS) {
  const ref = momentoDeTasa(tasas)
  if (ref == null) return true
  return ahora - ref > vencidaMs
}

/**
 * Lee el caché de localStorage (storage INYECTADO). Devuelve la tasa si existe,
 * es válida y no superó `ttlMs`; null en cualquier otro caso. Atrapado todo en
 * try/catch: en modo privado o con storage roto nunca rompe la app.
 */
export function leerTasasCache(storage, ahora = Date.now(), ttlMs = TASA_TTL_MS) {
  try {
    const crudo = storage?.getItem?.(TASAS_CACHE_CLAVE)
    if (!crudo) return null
    const datos = JSON.parse(crudo)
    if (!datos || !tasasValidas(datos.tasas)) return null
    const guardadoEn = Number(datos.guardadoEn)
    if (!Number.isFinite(guardadoEn) || ahora - guardadoEn > ttlMs) return null
    return { ...datos.tasas, guardadoEn }
  } catch {
    return null
  }
}

/** Guarda la tasa en el caché (storage INYECTADO). true si escribió. */
export function guardarTasasCache(storage, tasas, ahora = Date.now()) {
  try {
    if (!storage?.setItem) return false
    storage.setItem(TASAS_CACHE_CLAVE, JSON.stringify({ tasas, guardadoEn: ahora }))
    return true
  } catch {
    return false
  }
}
