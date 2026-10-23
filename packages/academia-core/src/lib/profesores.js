/*
 * Helpers puros del acceso de profesores (Fase 7). No tocan Firestore.
 *
 * El profesor carga la asistencia con su PROPIO enum de tres estados:
 * `presente | ausente_con_aviso | ausente_sin_aviso`. El cierre del admin usa
 * otro enum histórico: `presente | ausente_avisada | ausente_sin_aviso`. Acá
 * viven la validación del mapa `porAlumno` del profesor y los DOS mapeos entre
 * ambos enums (uno para precargar el cierre, otro por si hace falta al revés).
 */

/** Los tres estados que puede cargar un profesor, en el orden de la UI. */
export const ESTADOS_ASISTENCIA_PROFESOR = Object.freeze([
  'presente',
  'ausente_con_aviso',
  'ausente_sin_aviso',
])

/** Estado del profesor → estado del cierre. */
const A_CIERRE = Object.freeze({
  presente: 'presente',
  ausente_con_aviso: 'ausente_avisada',
  ausente_sin_aviso: 'ausente_sin_aviso',
})

/** Estado del cierre → estado del profesor. */
const DESDE_CIERRE = Object.freeze({
  presente: 'presente',
  ausente_avisada: 'ausente_con_aviso',
  ausente_sin_aviso: 'ausente_sin_aviso',
})

/** ¿El estado pertenece al enum del profesor? */
export function estadoProfesorValido(estado) {
  return ESTADOS_ASISTENCIA_PROFESOR.includes(estado)
}

/**
 * Estado del cierre equivalente al que cargó el profesor. Devuelve `null` si el
 * valor no pertenece al enum del profesor, para que quien precargue el cierre
 * use el valor por defecto en vez de confiar en un dato raro.
 */
export function estadoProfesorAEstadoCierre(estado) {
  return A_CIERRE[estado] ?? null
}

/**
 * Estado del profesor equivalente a un estado del cierre. Devuelve `null` si no
 * hay equivalencia (p. ej. un estado del cierre desconocido).
 */
export function estadoCierreAEstadoProfesor(estado) {
  return DESDE_CIERRE[estado] ?? null
}

/**
 * Valida y normaliza el mapa `porAlumno` que carga el profesor: un objeto con
 * EXACTAMENTE una entrada por alumno asignado (ni de más ni de menos, sin claves
 * desconocidas) y cada valor del enum del profesor. Lanza `Error` con un mensaje
 * claro si algo no cuadra; devuelve un objeto nuevo con las claves en el orden
 * de `alumnoIds`. La capa de datos reenvuelve el `Error` en su error de negocio.
 */
export function normalizarPorAlumnoProfesor(porAlumno, alumnoIds) {
  if (!porAlumno || typeof porAlumno !== 'object' || Array.isArray(porAlumno)) {
    throw new Error('La asistencia del profesor debe ser un objeto por alumno')
  }
  if (!Array.isArray(alumnoIds) || alumnoIds.length < 1) {
    throw new Error('La clase no tiene alumnos asignados')
  }
  const esperadas = new Set(alumnoIds)
  const sobrantes = Object.keys(porAlumno).filter((clave) => !esperadas.has(clave))
  if (sobrantes.length) {
    throw new Error(`La asistencia trae alumnos que no están en la clase: ${sobrantes.join(', ')}`)
  }
  const resultado = {}
  for (const alumnoId of alumnoIds) {
    const estado = porAlumno[alumnoId]
    if (estado === undefined) {
      throw new Error('La asistencia del profesor debe tener una entrada por cada alumno')
    }
    if (!estadoProfesorValido(estado)) {
      throw new Error(
        `Estado de asistencia inválido "${estado}". Permitidos: ${ESTADOS_ASISTENCIA_PROFESOR.join(', ')}`,
      )
    }
    resultado[alumnoId] = estado
  }
  return resultado
}
