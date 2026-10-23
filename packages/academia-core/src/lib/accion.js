/*
 * Lógica PURA del estado "ocupado" de una acción (feedback no intrusivo).
 *
 * Regla de UX (Parte 1):
 * - Al hacer clic el botón se DESHABILITA al instante.
 * - El spinner y la etiqueta de ocupado aparecen solo si la acción tarda más de
 *   RETRASO_OCUPADO_MS; una vez visibles se quedan al menos MIN_VISIBLE_OCUPADO_MS
 *   para no parpadear.
 *
 * Sin React: el hook (src/hooks/useAccion.js) maneja los temporizadores y este
 * módulo decide, en función de tiempos inyectados, cuándo mostrar y cuándo
 * reiniciar. Así todo se puede probar sin navegador.
 */

/** Tiempo que se espera antes de mostrar el spinner (evita el parpadeo). */
export const RETRASO_OCUPADO_MS = 400

/** Tiempo mínimo que el spinner queda visible una vez mostrado. */
export const MIN_VISIBLE_OCUPADO_MS = 500

/** Tiempo que el botón muestra "Guardado ✓" tras un guardado de rutina. */
export const DURACION_EXITO_MS = 1000

/** Tiempo que se espera antes de mostrar la barra de progreso de carga. */
export const RETRASO_CARGA_MS = 500

/** Etiqueta por defecto cuando no se especifica una. */
export const TEXTO_OCUPADO = 'Procesando…'

/** Etiqueta del estado de éxito del botón (guardados de rutina). */
export const TEXTO_EXITO_BOTON = 'Guardado ✓'

/** Estado inicial: quieto. */
export const OCUPADO_INICIAL = Object.freeze({
  activo: false,
  visible: false,
  inicio: 0,
  visibleDesde: 0,
})

/** Arranca una acción en `ahora`: ocupado pero todavía sin spinner. */
export function iniciarOcupado(ahora) {
  return { activo: true, visible: false, inicio: ahora, visibleDesde: 0 }
}

/** Marca el spinner como visible (lo dispara el temporizador de retraso). */
export function mostrarOcupado(estado, ahora) {
  if (!estado.activo || estado.visible) return estado
  return { ...estado, visible: true, visibleDesde: ahora }
}

/** La acción terminó (éxito o error): deja de estar `activo`. */
export function terminarOcupado(estado) {
  if (!estado.activo) return estado
  return { ...estado, activo: false }
}

/**
 * ¿El spinner debe verse ahora? Se ve mientras `visible` sea true, incluso en la
 * cola posterior al fin de la acción (para cumplir el mínimo).
 */
export function estaOcupado(estado) {
  return estado.activo || estado.visible
}

/**
 * ¿Se puede volver al estado inicial en `ahora`? Solo si la acción terminó y,
 * o bien el spinner nunca se mostró, o ya pasó el mínimo visible.
 */
export function puedeReiniciar(estado, ahora, minimo = MIN_VISIBLE_OCUPADO_MS) {
  if (estado.activo) return false
  if (!estado.visible || !estado.visibleDesde) return true
  return ahora - estado.visibleDesde >= minimo
}

/** Milisegundos que faltan para poder reiniciar (0 si ya se puede). */
export function esperaParaReiniciar(estado, ahora, minimo = MIN_VISIBLE_OCUPADO_MS) {
  if (!estado.visible || !estado.visibleDesde) return 0
  return Math.max(0, minimo - (ahora - estado.visibleDesde))
}

/**
 * Decide si hay que mostrar el spinner por primera vez: la acción sigue activa y
 * ya pasó el retraso. El hook la usa dentro del temporizador, pero es pura.
 */
export function debeMostrarSpinner(estado, ahora, retraso = RETRASO_OCUPADO_MS) {
  if (!estado.activo || estado.visible) return false
  return ahora - estado.inicio >= retraso
}

/** Retraso real: 0 para acciones "inmediatas" (PDF, BCV, reportes). */
export function retrasoDe(inmediato, retraso = RETRASO_OCUPADO_MS) {
  return inmediato ? 0 : retraso
}

/**
 * ¿Hay que mostrar la barra de progreso tras `transcurridoMs`? Se muestra solo
 * si la carga ya pasó el retraso (para no parpadear en cargas instantáneas).
 */
export function debeMostrarCarga(transcurridoMs, retraso = RETRASO_CARGA_MS) {
  return transcurridoMs >= retraso
}
