/*
 * Cobros: lógica PURA de perfiles de cobro, parámetros de la academia y precio
 * sugerido de una clase. Sin React y sin Firestore: la capa de datos
 * (src/firebase/db.js) valida y persiste; acá viven los defaults y las reglas
 * de negocio reutilizables por la UI y por los tests.
 */

import { DURACIONES_VALIDAS, MINUTOS_BLOQUE } from './agenda.js'
import { LIMITE_MONTO_CENTS, centsValidos } from './dinero.js'

/** Modos de un perfil de cobro: monto total del bloque o por persona. */
export const MODOS_COBRO = ['total', 'por_persona']

/** Motivos de un ajuste manual del precio de una clase. */
export const MOTIVOS_AJUSTE = ['descuento', 'cortesia', 'acuerdo', 'otro']

/** Cantidad máxima de personas de un perfil (mismo tope que el cupo de clase). */
export const PERSONAS_MAX = 4

/** Tope de largo del nombre de un perfil de cobro (igual que sede/cancha). */
export const LIMITE_NOMBRE_PERFIL = 100

/*
 * Perfiles de cobro por defecto de una academia. Llevan `id` FIJO para que el
 * seed pueda escribir tarifas por sede apuntando a ellos y para que la app los
 * reconozca. `personas` es la cantidad que "encaja" con el cupo de una clase
 * (`null` = cualquiera, p. ej. Corporativo o Especial).
 */
export const PERFILES_COBRO_DEFAULT = Object.freeze([
  Object.freeze({ id: 'individual', nombre: 'Individual', personas: 1, modo: 'total', activo: true, orden: 1 }),
  Object.freeze({ id: 'pareja', nombre: 'Pareja', personas: 2, modo: 'total', activo: true, orden: 2 }),
  Object.freeze({ id: 'tres', nombre: 'Tres personas', personas: 3, modo: 'total', activo: true, orden: 3 }),
  Object.freeze({ id: 'cuatro', nombre: 'Cuatro personas', personas: 4, modo: 'total', activo: true, orden: 4 }),
  Object.freeze({ id: 'corporativo', nombre: 'Corporativo', personas: null, modo: 'total', activo: true, orden: 5 }),
  Object.freeze({ id: 'especial', nombre: 'Especial', personas: null, modo: 'total', activo: true, orden: 6 }),
])

/** ¿La cantidad de personas de un perfil es válida? (1..PERSONAS_MAX o null). */
export function personasValidas(personas) {
  return personas === null || (Number.isInteger(personas) && personas >= 1 && personas <= PERSONAS_MAX)
}

/** ¿El modo de cobro es válido? */
export function modoValido(modo) {
  return MODOS_COBRO.includes(modo)
}

/** ¿El motivo de ajuste es válido? */
export function motivoValido(motivo) {
  return motivo === null || motivo === undefined || MOTIVOS_AJUSTE.includes(motivo)
}

/**
 * Perfil ACTIVO que "encaja" con el cupo de la clase (mismo `personas`), o
 * `null`. Si hubiera varios, gana el de menor `orden`. Se usa para
 * preseleccionar el perfil al reservar/reprogramar.
 */
export function perfilPorCupo(perfiles, cupo) {
  if (!Number.isInteger(cupo)) return null
  return (
    (perfiles ?? [])
      .filter((perfil) => perfil.activo !== false && perfil.personas === cupo)
      .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0))[0] ?? null
  )
}

/**
 * Precio sugerido en centavos: tarifa por hora del perfil en la sede × duración
 * en minutos / 60, y multiplicado por la cantidad de alumnos cuando el modo es
 * `por_persona`. Redondeo half-up a centavos. Devuelve `null` cuando NO hay
 * tarifa para ese perfil en esa sede (el caller debe pedir un monto manual).
 */
export function sugerirPrecioCents({ tarifaHoraCents, duracionMin, modo, cantidadAlumnos = 0 } = {}) {
  if (!Number.isInteger(tarifaHoraCents) || tarifaHoraCents < 0) return null
  if (!Number.isFinite(duracionMin) || duracionMin <= 0) return null
  const base = (tarifaHoraCents * duracionMin) / 60
  const alumnos = Number.isFinite(cantidadAlumnos) ? Math.max(0, cantidadAlumnos) : 0
  const total = modo === 'por_persona' ? base * alumnos : base
  return Math.round(total)
}

/**
 * Cobro a guardar al REPROGRAMAR una clase: si la clase NO fue ajustada a mano
 * se recalcula la sugerencia; si SÍ lo fue, se conserva el monto y el motivo
 * del ajuste, pero se actualiza `montoEstandarCents` (así la UI puede avisar
 * que "cambió el precio estándar"). Devuelve `null` si no hay cobro nuevo.
 */
export function recalcularCobro(cobroActual, sugerido = null) {
  if (sugerido == null) return cobroActual ?? null
  if (!cobroActual || !cobroActual.ajustado) return sugerido
  return {
    ...sugerido,
    montoCents: cobroActual.montoCents,
    ajustado: true,
    motivoAjuste: cobroActual.motivoAjuste ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Parámetros de la academia                                           */
/* ------------------------------------------------------------------ */

export const PAGO_PROFESOR_MODOS = ['por_hora', 'por_clase']
export const ALERTA_COBRO_REFERENCIAS = ['clase', 'vencimiento']

/** Qué hace la academia con la parte del alumno que avisó su ausencia (modo total). */
export const REPARTOS_AUSENCIA = ['absorbe_academia', 'reparte_entre_presentes']

/** Qué se le paga al profesor cuando NADIE asistió y hubo al menos una falta sin aviso. */
export const PAGOS_SIN_AVISO = ['completo', 'proporcional_cobrado', 'nada']

/** Conceptos de un cargo de alumno (Phase 4). */
export const CONCEPTOS_CARGO = ['clase', 'falta_sin_aviso', 'mensualidad', 'otro']

/** Métodos de pago aceptados (pago completo; los parciales quedan fuera de alcance). */
export const METODOS_PAGO = ['efectivo', 'zelle', 'pago_movil', 'transferencia', 'otro']

export const AUSENCIA_HORAS_MAX = 168
export const PORCENTAJE_MAX = 100
export const VENCIMIENTO_DIAS_MAX = 365
export const ALERTA_DIAS_MAX = 30
export const DURACION_MIN = 60
export const DURACION_MAX = 240

/**
 * Parámetros por defecto de una academia. Es la fuente de verdad de los
 * valores que se crean/leen cuando el documento `config/parametros` no existe o
 * viene incompleto.
 */
export const PARAMETROS_DEFAULT = Object.freeze({
  avisoAusenciaHoras: 24,
  porcentajeFaltaSinAviso: 50,
  pagoProfesor: Object.freeze({ modo: 'por_hora', montoCents: 1500 }),
  descuentoHermanosPct: 10,
  duracionesPermitidas: Object.freeze([...DURACIONES_VALIDAS]),
  vencimientoCreditoDias: null,
  alertaCobro: Object.freeze({ dias: 2, referencia: 'clase' }),
  restringirCategoriaPorFranja: false,
  repartoAusenciaAvisada: 'absorbe_academia',
  pagoProfesorSiTodosFaltanSinAviso: 'completo',
})

/** Entero dentro de [min, max] inclusive. */
export function enteroEnRango(valor, min, max) {
  return Number.isInteger(valor) && valor >= min && valor <= max
}

/**
 * ¿La lista de duraciones permitidas es válida? No vacía, única, ascendente y
 * cada valor múltiplo de MINUTOS_BLOQUE entre DURACION_MIN y DURACION_MAX.
 */
export function duracionesValidas(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return false
  if (
    !lista.every(
      (d) => Number.isInteger(d) && d >= DURACION_MIN && d <= DURACION_MAX && d % MINUTOS_BLOQUE === 0,
    )
  ) {
    return false
  }
  for (let i = 1; i < lista.length; i += 1) {
    if (lista[i] <= lista[i - 1]) return false
  }
  return true
}

/** ¿El mapa `pagoProfesor` es válido? */
export function pagoProfesorValido(valor) {
  return (
    valor != null &&
    typeof valor === 'object' &&
    !Array.isArray(valor) &&
    PAGO_PROFESOR_MODOS.includes(valor.modo) &&
    centsValidos(valor.montoCents, LIMITE_MONTO_CENTS)
  )
}

/** ¿El mapa `alertaCobro` es válido? */
export function alertaCobroValida(valor) {
  return (
    valor != null &&
    typeof valor === 'object' &&
    !Array.isArray(valor) &&
    enteroEnRango(valor.dias, 0, ALERTA_DIAS_MAX) &&
    ALERTA_COBRO_REFERENCIAS.includes(valor.referencia)
  )
}

/** ¿El vencimiento de un crédito es válido? (`null` = no vence). */
export function vencimientoValido(valor) {
  return valor === null || enteroEnRango(valor, 1, VENCIMIENTO_DIAS_MAX)
}

/** ¿El reparto de una ausencia avisada es válido? */
export function repartoAusenciaValido(valor) {
  return REPARTOS_AUSENCIA.includes(valor)
}

/** ¿El pago al profesor cuando todos faltan sin aviso es válido? */
export function pagoSinAvisoValido(valor) {
  return PAGOS_SIN_AVISO.includes(valor)
}

/**
 * Lector TOLERANTE de los parámetros: rellena campo por campo con el default
 * cuando falta o está corrupto. Nunca lanza. Es lo que usan la agenda y el
 * formulario de reserva para no romperse con datos viejos.
 */
export function leerParametros(doc) {
  const d = doc ?? {}
  const pago = pagoProfesorValido(d.pagoProfesor)
    ? { modo: d.pagoProfesor.modo, montoCents: d.pagoProfesor.montoCents }
    : { ...PARAMETROS_DEFAULT.pagoProfesor }
  const alerta = alertaCobroValida(d.alertaCobro)
    ? { dias: d.alertaCobro.dias, referencia: d.alertaCobro.referencia }
    : { ...PARAMETROS_DEFAULT.alertaCobro }

  return {
    avisoAusenciaHoras: enteroEnRango(d.avisoAusenciaHoras, 0, AUSENCIA_HORAS_MAX)
      ? d.avisoAusenciaHoras
      : PARAMETROS_DEFAULT.avisoAusenciaHoras,
    porcentajeFaltaSinAviso: enteroEnRango(d.porcentajeFaltaSinAviso, 0, PORCENTAJE_MAX)
      ? d.porcentajeFaltaSinAviso
      : PARAMETROS_DEFAULT.porcentajeFaltaSinAviso,
    pagoProfesor: pago,
    descuentoHermanosPct: enteroEnRango(d.descuentoHermanosPct, 0, PORCENTAJE_MAX)
      ? d.descuentoHermanosPct
      : PARAMETROS_DEFAULT.descuentoHermanosPct,
    duracionesPermitidas: duracionesValidas(d.duracionesPermitidas)
      ? [...d.duracionesPermitidas]
      : [...PARAMETROS_DEFAULT.duracionesPermitidas],
    vencimientoCreditoDias: vencimientoValido(d.vencimientoCreditoDias)
      ? d.vencimientoCreditoDias
      : PARAMETROS_DEFAULT.vencimientoCreditoDias,
    alertaCobro: alerta,
    restringirCategoriaPorFranja:
      typeof d.restringirCategoriaPorFranja === 'boolean'
        ? d.restringirCategoriaPorFranja
        : PARAMETROS_DEFAULT.restringirCategoriaPorFranja,
    repartoAusenciaAvisada: repartoAusenciaValido(d.repartoAusenciaAvisada)
      ? d.repartoAusenciaAvisada
      : PARAMETROS_DEFAULT.repartoAusenciaAvisada,
    pagoProfesorSiTodosFaltanSinAviso: pagoSinAvisoValido(d.pagoProfesorSiTodosFaltanSinAviso)
      ? d.pagoProfesorSiTodosFaltanSinAviso
      : PARAMETROS_DEFAULT.pagoProfesorSiTodosFaltanSinAviso,
  }
}

/* ------------------------------------------------------------------ */
/* Cierre de una clase: cargos del alumno y pago al profesor           */
/* ------------------------------------------------------------------ */

/**
 * Reparte `total` centavos en `n` partes lo más iguales posible. El resto (los
 * centavos que no se pueden dividir) se suma a las PRIMERAS partes, de modo que
 * la suma de las partes es exactamente `total`. Devuelve [] si `n <= 0`.
 */
export function repartirCents(total, n) {
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(n) || n <= 0) return []
  const base = Math.floor(total / n)
  const resto = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0))
}

/** Redondeo half-up a centavos de una razón de dinero; 0 si no es finita o <= 0. */
function redondearCents(valor) {
  return Number.isFinite(valor) && valor > 0 ? Math.round(valor) : 0
}

/**
 * Cálculo PURO del cierre de una clase (Phase 4). Sin Firestore ni React: la
 * capa de datos lo usa dentro de la transacción de `cerrarClase` y los tests
 * lo ejercitan directo.
 *
 * Devuelve `{ cargos, pagoProfesor: { montoCents, base }, resumen }`:
 * - `cargos`: `[{ alumnoId, concepto, montoCents }]` (los de 0 centavos NO se
 *   crean). `concepto` ∈ `clase` | `falta_sin_aviso`.
 * - `pagoProfesor.montoCents`: lo que se le paga al profesor. `base` es el
 *   monto base ANTES de la regla de "todos faltaron sin aviso".
 * - `resumen`: conteos y totales para la UI.
 *
 * Reglas (ver docs/modelo-datos.md §5.3):
 * - Monto de la clase: `cobro.montoCents`. Si el modo es `por_persona` y NO fue
 *   ajustado a mano, se recalcula como `tarifaHoraCents × duración / 60` por
 *   alumno (half-up); si fue ajustado, `montoCents` es el total.
 * - Reparto por alumno: `total` → partes iguales entre TODOS los asignados
 *   (resto a los primeros); `por_persona` → la parte de cada uno.
 * - `presente` → cargo `clase`. `ausente_avisada` → sin cargo (o su parte se
 *   reparte entre los presentes si `repartoAusenciaAvisada` =
 *   `reparte_entre_presentes` y el modo es `total`). `ausente_sin_aviso` →
 *   cargo `falta_sin_aviso` con `porcentajeFaltaSinAviso` % de su parte.
 * - Cortesía (monto 0 con motivo `cortesia`): no se registra nada para alumnos.
 * - `seFactura: false` (fuerza mayor): ni cargos ni pago al profesor.
 */
export function calcularCierre({ cobro, duracionMin, asistencias = [], parametros = {}, seFactura = true } = {}) {
  const registros = Array.isArray(asistencias) ? asistencias : []
  const alumnos = registros.map((r) => ({ alumnoId: r.alumnoId, estado: r.estado }))
  const n = alumnos.length

  const presentes = alumnos.filter((a) => a.estado === 'presente')
  const avisadas = alumnos.filter((a) => a.estado === 'ausente_avisada')
  const sinAviso = alumnos.filter((a) => a.estado === 'ausente_sin_aviso')

  const modo = cobro?.modo ?? 'total'
  const ajustado = Boolean(cobro?.ajustado)
  const esCortesia = cobro != null && cobro.montoCents === 0 && cobro.motivoAjuste === 'cortesia'
  const facturable = seFactura && !esCortesia && cobro != null && n > 0

  // 1) Parte (share) de cada alumno, en el orden de `alumnos`.
  let shares = alumnos.map(() => 0)
  let montoClaseCents = 0
  if (facturable) {
    if (modo === 'por_persona' && !ajustado) {
      const tarifa = Number.isInteger(cobro.tarifaHoraCents) ? cobro.tarifaHoraCents : 0
      const porAlumno = redondearCents((tarifa * (Number(duracionMin) || 0)) / 60)
      shares = alumnos.map(() => porAlumno)
      montoClaseCents = porAlumno * n
    } else {
      // 'total' (o 'por_persona' ajustado, donde montoCents es el total).
      montoClaseCents = centsValidos(cobro.montoCents, LIMITE_MONTO_CENTS) ? cobro.montoCents : 0
      shares = repartirCents(montoClaseCents, n)
    }
  }

  // 2) Reparto de la parte de los avisados entre los presentes (solo modo total).
  const repartirAvisadas =
    facturable && modo === 'total' && parametros.repartoAusenciaAvisada === 'reparte_entre_presentes'
  if (repartirAvisadas && presentes.length > 0 && avisadas.length > 0) {
    const pool = avisadas.reduce((total, a) => total + shares[alumnos.indexOf(a)], 0)
    if (pool > 0) {
      const extra = repartirCents(pool, presentes.length)
      presentes.forEach((p, k) => {
        shares[alumnos.indexOf(p)] += extra[k]
      })
    }
  }

  // 3) Cargos.
  const pct = enteroEnRango(parametros.porcentajeFaltaSinAviso, 0, PORCENTAJE_MAX)
    ? parametros.porcentajeFaltaSinAviso
    : 0
  const cargos = []
  if (facturable) {
    alumnos.forEach((alumno, i) => {
      const parte = shares[i]
      if (alumno.estado === 'presente') {
        if (parte > 0) cargos.push({ alumnoId: alumno.alumnoId, concepto: 'clase', montoCents: parte })
      } else if (alumno.estado === 'ausente_sin_aviso') {
        const monto = redondearCents((parte * pct) / 100)
        if (monto > 0) {
          cargos.push({ alumnoId: alumno.alumnoId, concepto: 'falta_sin_aviso', montoCents: monto })
        }
      }
    })
  }
  const totalCargosCents = cargos.reduce((total, cargo) => total + cargo.montoCents, 0)

  // 4) Pago al profesor.
  const pago = pagoProfesorValido(parametros.pagoProfesor)
    ? parametros.pagoProfesor
    : PARAMETROS_DEFAULT.pagoProfesor
  const base =
    pago.modo === 'por_hora'
      ? redondearCents((pago.montoCents * (Number(duracionMin) || 0)) / 60)
      : Number.isInteger(pago.montoCents)
        ? pago.montoCents
        : 0

  let montoProfesor = 0
  if (seFactura) {
    if (presentes.length > 0) {
      montoProfesor = base
    } else if (sinAviso.length > 0) {
      const regla =
        parametros.pagoProfesorSiTodosFaltanSinAviso ??
        PARAMETROS_DEFAULT.pagoProfesorSiTodosFaltanSinAviso
      if (regla === 'completo') montoProfesor = base
      else if (regla === 'proporcional_cobrado') montoProfesor = Math.min(base, totalCargosCents)
      // 'nada' → 0
    }
  }

  return {
    cargos,
    pagoProfesor: { montoCents: montoProfesor, base },
    resumen: {
      totalAlumnos: n,
      presentes: presentes.length,
      ausentesAvisadas: avisadas.length,
      ausentesSinAviso: sinAviso.length,
      montoClaseCents,
      totalCargosCents,
      baseProfesorCents: base,
    },
  }
}
