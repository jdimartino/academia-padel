/*
 * Lógica PURA de los avisos al usuario (feedback unificado): la cola de
 * diálogos (error / confirmación) y los toasts de éxito, más el formateo de la
 * referencia de un error técnico.
 *
 * Sin React y sin Firestore: el provider (src/context/AvisosContext.jsx) solo
 * guarda este estado y dispara los temporizadores. Cada acción devuelve un
 * estado NUEVO; nada se muta.
 */

import { formatHora12 } from './agenda.js'

/** Milisegundos que un toast queda visible antes de irse solo. */
export const DURACION_TOAST = 3500

/** Tope de toasts visibles a la vez; el más viejo se descarta. */
export const MAX_TOASTS = 3

/** Único título de los diálogos de error. */
export const TITULO_ERROR = 'Revisa esto'

/** Único mensaje de un error TÉCNICO (los de negocio muestran su propio texto). */
export const MENSAJE_TECNICO = 'No se pudo guardar. Inténtalo de nuevo.'

/**
 * Errores de NEGOCIO de db.js (mensajes en español escritos a propósito): se
 * muestran tal cual, sin referencia. Se identifican por `name` para no importar
 * db.js desde acá (arrastraría Firestore y este módulo debe seguir siendo puro).
 * Ver SolapamientoError, ClaseInvalidaError, FichaInvalidaError y
 * SedeInvalidaError en src/firebase/db.js.
 */
export const ERRORES_DE_NEGOCIO = [
  'SolapamientoError',
  'ClaseInvalidaError',
  'FichaInvalidaError',
  'SedeInvalidaError',
]

/** Estado inicial de los avisos. */
export const AVISOS_INICIAL = Object.freeze({
  dialogos: [],
  toasts: [],
  siguienteToast: 1,
})

/** Caracas es UTC-4 todo el año (sin horario de verano). */
const OFFSET_CARACAS_MINUTOS = -4 * 60

/*
 * Solo se aceptan claves con caracteres "seguros". Un email, una ruta o un id
 * con espacios no pasan: caen al valor por defecto. Es la garantía de que la
 * referencia visible nunca filtra datos del usuario.
 */
const RE_CLAVE = /^[A-Za-z0-9._/-]{1,48}$/

/** ¿El error viene de la capa de datos con un mensaje pensado para el usuario? */
export function esErrorDeNegocio(error) {
  return (
    Boolean(error) &&
    typeof error.name === 'string' &&
    ERRORES_DE_NEGOCIO.includes(error.name)
  )
}

function sanearClave(valor, porDefecto) {
  const texto = String(valor ?? '').trim()
  return RE_CLAVE.test(texto) ? texto : porDefecto
}

/**
 * Código del error para la referencia: `error.code` si es un string, si no
 * `error.name`, si no "desconocido". Se descarta cualquier valor que no parezca
 * un código (emails, rutas, textos con espacios).
 */
export function codigoDeError(error) {
  if (typeof error?.code === 'string' && error.code.trim()) {
    return sanearClave(error.code, 'desconocido')
  }
  if (typeof error?.name === 'string' && error.name.trim()) {
    return sanearClave(error.name, 'desconocido')
  }
  return 'desconocido'
}

/**
 * Fecha y hora de Caracas (UTC-4 fijo, aritmética de offset; nunca toISOString
 * para la fecha local) como "06/10/2026 3:45 PM". Usa `formatHora12`.
 */
export function fechaHoraCaracas(ahora = new Date()) {
  const instante = ahora instanceof Date ? ahora.getTime() : new Date(ahora).getTime()
  const caracas = new Date(instante + OFFSET_CARACAS_MINUTOS * 60 * 1000)
  const dia = String(caracas.getUTCDate()).padStart(2, '0')
  const mes = String(caracas.getUTCMonth() + 1).padStart(2, '0')
  const anio = caracas.getUTCFullYear()
  const hhmm = `${String(caracas.getUTCHours()).padStart(2, '0')}:${String(
    caracas.getUTCMinutes(),
  ).padStart(2, '0')}`
  return `${dia}/${mes}/${anio} ${formatHora12(hhmm)}`
}

/**
 * Línea de referencia de un error técnico:
 *   "Referencia: {accion} · {codigo} · {fecha y hora}"
 * `accion` es la clave kebab-case que pasa cada punto de llamada; `ahora` es
 * inyectable para poder probarlo.
 */
export function formatearReferencia(accion, error, ahora = new Date()) {
  const clave = sanearClave(accion, 'accion')
  return `Referencia: ${clave} · ${codigoDeError(error)} · ${fechaHoraCaracas(ahora)}`
}

/**
 * Arma el diálogo de error a partir del error capturado:
 * - error de negocio → su mensaje tal cual, sin referencia;
 * - cualquier otra cosa (FirebaseError, TypeError, red, desconocido) → mensaje
 *   técnico único + referencia copiable.
 */
export function avisoDeError(accion, error, ahora = new Date()) {
  if (esErrorDeNegocio(error)) {
    const mensaje = String(error?.message ?? '').trim() || MENSAJE_TECNICO
    return { clave: `error:${mensaje}`, mensaje, tecnico: false, referencia: null }
  }
  const clave = sanearClave(accion, 'accion')
  const codigo = codigoDeError(error)
  return {
    clave: `tecnico:${clave}:${codigo}`,
    mensaje: MENSAJE_TECNICO,
    tecnico: true,
    referencia: formatearReferencia(clave, error, ahora),
    accion: clave,
    codigo,
  }
}

/*
 * Cola de diálogos: se muestra uno por vez (el primero) y los demás esperan.
 * Un diálogo idéntico (misma `clave`) ya mostrado o en cola no se duplica.
 */
function agregarDialogo(estado, dialogo) {
  if (estado.dialogos.some((enCola) => enCola.clave === dialogo.clave)) return estado
  return { ...estado, dialogos: [...estado.dialogos, dialogo] }
}

/** Encola un diálogo de error. El mensaje es obligatorio. */
export function mostrarError(estado, aviso = {}) {
  const mensaje = String(aviso?.mensaje ?? '').trim()
  if (!mensaje) return estado
  return agregarDialogo(estado, {
    ...aviso,
    tipo: 'error',
    titulo: TITULO_ERROR,
    mensaje,
    tecnico: Boolean(aviso.tecnico),
    referencia: aviso.referencia ?? null,
    clave: aviso.clave ?? `error:${mensaje}`,
  })
}

/** Encola un diálogo de confirmación (dos botones; el de cancelar va enfocado). */
export function mostrarConfirmacion(estado, confirmacion = {}) {
  const mensaje = String(confirmacion?.mensaje ?? '').trim()
  if (!mensaje) return estado
  return agregarDialogo(estado, {
    tipo: 'confirm',
    titulo: confirmacion.titulo ?? '¿Salir sin guardar?',
    mensaje,
    textoConfirmar: confirmacion.textoConfirmar ?? 'Salir sin guardar',
    textoCancelar: confirmacion.textoCancelar ?? 'Seguir editando',
    tecnico: false,
    referencia: null,
    clave: confirmacion.clave ?? `confirm:${mensaje}`,
  })
}

/** Cierra el diálogo que se está mostrando y deja pasar al siguiente en cola. */
export function cerrarError(estado) {
  if (!estado.dialogos.length) return estado
  return { ...estado, dialogos: estado.dialogos.slice(1) }
}

/** Diálogo visible ahora mismo (o null). */
export function dialogoActual(estado) {
  return estado.dialogos[0] ?? null
}

/** ¿Hay algún diálogo abierto o en cola? */
export function hayDialogo(estado) {
  return estado.dialogos.length > 0
}

/**
 * Encola un toast de éxito. Cada toast tiene id y duración propios; con más de
 * MAX_TOASTS visibles se descarta el más viejo.
 */
export function mostrarExito(estado, mensaje, ahora = Date.now()) {
  const texto = String(mensaje ?? '').trim()
  if (!texto) return estado
  const toast = {
    id: `toast-${estado.siguienteToast}`,
    mensaje: texto,
    creadoEn: ahora,
    duracion: DURACION_TOAST,
  }
  return {
    ...estado,
    siguienteToast: estado.siguienteToast + 1,
    toasts: [...estado.toasts, toast].slice(-MAX_TOASTS),
  }
}

/** Cierra un toast por id (clic del usuario). */
export function cerrarToast(estado, id) {
  const toasts = estado.toasts.filter((toast) => toast.id !== id)
  return toasts.length === estado.toasts.length ? estado : { ...estado, toasts }
}

/** IDs de los toasts cuyo tiempo ya venció. */
export function toastsVencidos(estado, ahora = Date.now()) {
  return estado.toasts
    .filter((toast) => ahora - toast.creadoEn >= toast.duracion)
    .map((toast) => toast.id)
}

/** Cierra todos los toasts vencidos (lo llama el temporizador del provider). */
export function cerrarVencidos(estado, ahora = Date.now()) {
  const ids = new Set(toastsVencidos(estado, ahora))
  if (!ids.size) return estado
  return { ...estado, toasts: estado.toasts.filter((toast) => !ids.has(toast.id)) }
}

/* ------------------------------------------------------------------ */
/* Cambios sin guardar (detección de "sucio" de un formulario)          */
/* ------------------------------------------------------------------ */

/** Igualdad estructural para valores planos (objetos, arreglos, primitivos). */
function iguales(a, b) {
  if (a === b) return true
  if (a == null && b == null) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((valor, i) => iguales(valor, b[i]))
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const clavesA = Object.keys(a)
  const clavesB = Object.keys(b)
  if (clavesA.length !== clavesB.length) return false
  return clavesA.every((clave) => Object.hasOwn(b, clave) && iguales(a[clave], b[clave]))
}

/**
 * ¿El formulario tiene cambios sin guardar? Compara la foto de los valores
 * iniciales contra los actuales, campo por campo.
 */
export function hayCambios(inicial, actual) {
  return !iguales(inicial, actual)
}
