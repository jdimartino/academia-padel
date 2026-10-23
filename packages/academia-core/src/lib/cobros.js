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

/* ----- Phase 5: planes de alumno y créditos (mensualidades) ---------- */

/** Qué hace una falta sin aviso cuando el alumno tiene crédito disponible. */
export const FALTAS_CON_CREDITO = ['descuenta_proporcional', 'descuenta_completo', 'cobra_aparte']

/** Frecuencia de un plan de alumno. */
export const FRECUENCIAS_PLAN = ['semanal', 'mensual']

/** Estados de un lote de crédito (el vencimiento se evalúa de forma perezosa). */
export const ESTADOS_CREDITO = ['activo', 'agotado', 'vencido', 'anulado']

/** Motivos de un movimiento de crédito. */
export const MOTIVOS_MOVIMIENTO = ['clase', 'falta_sin_aviso']

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
  faltaSinAvisoConCredito: 'descuenta_completo',
  creditoRequierePago: true,
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

/** ¿La regla de una falta sin aviso con crédito es válida? */
export function faltaConCreditoValida(valor) {
  return FALTAS_CON_CREDITO.includes(valor)
}

/** ¿La frecuencia de un plan es válida? */
export function frecuenciaPlanValida(valor) {
  return FRECUENCIAS_PLAN.includes(valor)
}

/**
 * ¿Los minutos incluidos de un plan son válidos? Entero > 0 y múltiplo de
 * MINUTOS_BLOQUE (30).
 */
export function minutosPlanValidos(minutos) {
  return Number.isInteger(minutos) && minutos > 0 && minutos % MINUTOS_BLOQUE === 0
}

/** ¿El precio de un plan es válido? Entero de centavos > 0 dentro del tope. */
export function precioPlanValido(cents) {
  return centsValidos(cents, LIMITE_MONTO_CENTS) && cents > 0
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
    faltaSinAvisoConCredito: faltaConCreditoValida(d.faltaSinAvisoConCredito)
      ? d.faltaSinAvisoConCredito
      : PARAMETROS_DEFAULT.faltaSinAvisoConCredito,
    creditoRequierePago:
      typeof d.creditoRequierePago === 'boolean'
        ? d.creditoRequierePago
        : PARAMETROS_DEFAULT.creditoRequierePago,
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
      facturable,
      duracionMin: Number(duracionMin) || 0,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Créditos (Phase 5): lotes, FIFO, vencimiento y consumo perezoso      */
/* ------------------------------------------------------------------ */

/** Redondeo half-up a minutos enteros; 0 si no es finito o <= 0. */
function redondearMinutos(valor) {
  return Number.isFinite(valor) && valor > 0 ? Math.round(valor) : 0
}

/** Minutos disponibles de un lote (comprados - usados, nunca negativo). */
export function minutosDisponibles(lote) {
  const comprados = Number.isInteger(lote?.minutosComprados) ? lote.minutosComprados : 0
  const usados = Number.isInteger(lote?.minutosUsados) ? lote.minutosUsados : 0
  return Math.max(0, comprados - usados)
}

/**
 * ¿El lote venció en `fecha`? El vencimiento es perezoso: no hay Functions ni
 * jobs, se evalúa al leer y al consumir. Un lote vence al terminar `venceEn`:
 * la fecha de vencimiento TODAVÍA se puede usar (`fecha > venceEn`).
 */
export function loteVencido(lote, fecha) {
  return Boolean(lote?.venceEn) && String(fecha ?? '') > lote.venceEn
}

/**
 * Estado EFECTIVO de un lote (el vencimiento se calcula, no se guarda).
 * Devuelve 'activo' | 'agotado' | 'vencido' | 'anulado' | 'bloqueado':
 * `bloqueado` = hay minutos pero `creditoRequierePago` y su cargo no está al
 * día. Un lote anulado nunca vuelve.
 */
export function estadoLote(lote, fecha, { creditoRequierePago = false, cargoPagado = true } = {}) {
  if (!lote || lote.estado === 'anulado') return 'anulado'
  if (loteVencido(lote, fecha)) return 'vencido'
  if (minutosDisponibles(lote) <= 0) return 'agotado'
  if (creditoRequierePago && !cargoPagado) return 'bloqueado'
  return 'activo'
}

/**
 * Orden FIFO de los lotes: primero por vencimiento (`venceEn` ascendente, los
 * que NO vencen van al final) y después por `inicio`. El id desempata.
 */
export function compararLotesFIFO(a, b) {
  const av = a?.venceEn ?? null
  const bv = b?.venceEn ?? null
  if (av !== bv) {
    if (av === null) return 1
    if (bv === null) return -1
    return av < bv ? -1 : 1
  }
  const ai = a?.inicio ?? ''
  const bi = b?.inicio ?? ''
  if (ai !== bi) return ai < bi ? -1 : 1
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
}

/** Lotes usables en `fecha` (estado efectivo 'activo'), en orden FIFO. */
export function lotesUsables(lotes, fecha, opciones = {}) {
  const { creditoRequierePago = false } = opciones
  return (lotes ?? [])
    .filter(
      (lote) =>
        estadoLote(lote, fecha, {
          creditoRequierePago,
          cargoPagado: lote.cargoPagado === true,
        }) === 'activo',
    )
    .sort(compararLotesFIFO)
}

/**
 * Consume `minutos` de una lista de lotes USABLES (en orden FIFO, el que ya
 * tenga la lista ordenada o no da igual: se ordena acá). NO consume parcial:
 * si no alcanza, devuelve el `faltante` y las asignaciones parciales calculadas
 * (el caller decide si las descarta). Devuelve `{ asignaciones, faltante }`.
 */
export function consumirCreditos(lotes, minutos) {
  const pedido = Number.isFinite(minutos) ? Math.max(0, Math.trunc(minutos)) : 0
  const asignaciones = []
  let restante = pedido
  for (const lote of [...(lotes ?? [])].sort(compararLotesFIFO)) {
    if (restante <= 0) break
    const disponible = minutosDisponibles(lote)
    const usar = Math.min(disponible, restante)
    if (usar > 0) {
      asignaciones.push({ creditoId: lote.id, minutos: usar })
      restante -= usar
    }
  }
  return { asignaciones, faltante: restante }
}

/**
 * Minutos que descuenta una falta sin aviso de un crédito, según la regla:
 * `descuenta_completo` = la duración de la clase; `descuenta_proporcional` =
 * `porcentajeFaltaSinAviso` % de la duración (half-up a minutos enteros);
 * `cobra_aparte` = 0 (no hay descuento: se cobra el cargo normal de Phase 4).
 */
export function minutosFaltaSinAviso(duracionMin, porcentaje, modo = PARAMETROS_DEFAULT.faltaSinAvisoConCredito) {
  const dur = Number.isFinite(duracionMin) ? Math.max(0, duracionMin) : 0
  if (modo === 'descuenta_completo') return dur
  if (modo === 'cobra_aparte') return 0
  const pct = enteroEnRango(porcentaje, 0, PORCENTAJE_MAX) ? porcentaje : 0
  return redondearMinutos((dur * pct) / 100)
}

/**
 * Precio de la mensualidad de un plan: `precioCents` menos el descuento de
 * hermanos (`pct`, half-up) cuando el plan lo tiene activado.
 */
export function precioMensualidad(plan, descuentoHermanosPct = 0) {
  const base = centsValidos(plan?.precioCents, LIMITE_MONTO_CENTS) ? plan.precioCents : 0
  if (!plan?.descuentoHermanos) return base
  const pct = enteroEnRango(descuentoHermanosPct, 0, PORCENTAJE_MAX) ? descuentoHermanosPct : 0
  if (pct <= 0) return base
  return base - redondearCents((base * pct) / 100)
}

/**
 * Preview PURO de lo que le va a pasar al crédito de un alumno al cerrar la
 * clase. La usa la UI (el diálogo de cierre) y es la MISMA regla que aplica
 * `cerrarClase` en db.js:
 *
 * - `presente` con crédito suficiente → usa `minutosClase` de crédito y NO
 *   genera cargo.
 * - `presente` sin crédito suficiente → cargo normal (`requiereCargo`, avisa
 *   `insuficiente`).
 * - `ausente_sin_aviso` → según `faltaSinAvisoConCredito`: descuenta minutos
 *   (proporcional o completo) si alcanza; si no, cae al cargo normal; o
 *   `cobra_aparte` = siempre cargo normal.
 * - `ausente_avisada` u otros estados → sin descuento ni cargo.
 *
 * Devuelve `{ usaCredito, minutos, motivo, requiereCargo, insuficiente? }`.
 */
export function previsualizarCreditoAlumno({
  estado,
  minutosClase = 0,
  minutosDisponibles: disponibles = 0,
  porcentajeFaltaSinAviso = 0,
  faltaSinAvisoConCredito = PARAMETROS_DEFAULT.faltaSinAvisoConCredito,
} = {}) {
  const clase = Number.isFinite(minutosClase) ? Math.max(0, minutosClase) : 0
  const credito = Number.isFinite(disponibles) ? Math.max(0, disponibles) : 0

  if (estado === 'presente') {
    if (clase > 0 && credito >= clase) {
      return { usaCredito: true, minutos: clase, motivo: 'clase', requiereCargo: false }
    }
    return { usaCredito: false, minutos: 0, motivo: 'clase', requiereCargo: true, insuficiente: true }
  }

  if (estado === 'ausente_sin_aviso') {
    if (faltaSinAvisoConCredito === 'cobra_aparte') {
      return {
        usaCredito: false,
        minutos: 0,
        motivo: 'falta_sin_aviso',
        requiereCargo: true,
        cobraAparte: true,
      }
    }
    const minutos = minutosFaltaSinAviso(clase, porcentajeFaltaSinAviso, faltaSinAvisoConCredito)
    if (minutos > 0 && credito >= minutos) {
      return { usaCredito: true, minutos, motivo: 'falta_sin_aviso', requiereCargo: false }
    }
    return {
      usaCredito: false,
      minutos: 0,
      motivo: 'falta_sin_aviso',
      requiereCargo: true,
      insuficiente: true,
    }
  }

  return { usaCredito: false, minutos: 0, motivo: null, requiereCargo: false }
}
