/*
 * CAPA ÚNICA DE ACCESO A DATOS
 * ----------------------------
 * Todo acceso a Firestore debe pasar por este archivo.
 * Ninguna página, componente o servicio puede importar `firebase/firestore`
 * directamente: si hace falta una consulta nueva, se agrega acá.
 *
 * Cada función recibe la instancia de Firestore como PRIMER argumento. Así el
 * mismo código corre en la app (instancia de `src/firebase/config.js`) y en los
 * tests contra el emulador, sin duplicar lógica de negocio.
 *
 * Reglas obligatorias (multi-tenant):
 * - Datos enraizados en academias/{tenantId}/... — siempre acotar por tenant.
 * - Toda consulta debe estar acotada: por tenant, por sede (venueId) y por
 *   rango de fechas, con límite y paginación. Nada de getDocs() sin where().
 * - Preferir lecturas puntuales (getDoc/getDocs). Los listeners en vivo
 *   (onSnapshot) solo cuando la pantalla realmente necesite datos en vivo.
 * - Escribir primero los índices compuestos en firestore.indexes.json.
 */

import {
  Timestamp,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  where,
} from 'firebase/firestore'
import { CATEGORIAS } from '../lib/agenda.js'

/** Granularidad de la ocupación: 30 minutos. Ver docs/modelo-datos.md §4.1. */
export const MINUTOS_BLOQUE = 30

/** Categorías válidas de una clase. Ver docs/modelo-datos.md §4. */
export { CATEGORIAS }

/** Estados en los que la clase ya está cerrada y no admite más asistencia. */
const ESTADOS_CERRADOS = ['pendiente_cobro', 'cobrada', 'cancelada']

/** Estados de asistencia admitidos (la regla de ausencia justificada queda sin definir). */
const ESTADOS_ASISTENCIA = ['presente', 'ausente']

function validarCategoria(categoria) {
  if (categoria != null && !CATEGORIAS.includes(categoria)) {
    throw new ClaseInvalidaError(
      `Categoría inválida "${categoria}". Permitidas: ${CATEGORIAS.join(', ')}`,
    )
  }
}

const RE_HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Error de negocio: el horario pedido ya está ocupado. */
export class SolapamientoError extends Error {
  constructor(bloque) {
    super(`El horario ya está ocupado (bloque ${bloque.id})`)
    this.name = 'SolapamientoError'
    this.bloque = bloque
  }
}

/** Error de negocio: los datos de la clase no sirven para bloquear bloques. */
export class ClaseInvalidaError extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'ClaseInvalidaError'
  }
}

/* --------------------------------------------------------------------- */
/* Utilidades de tiempo (puras, sin Firestore)                             */
/* --------------------------------------------------------------------- */

/** "18:30" → 1110 (minutos desde medianoche). */
export function aMinutos(hhmm) {
  const match = RE_HHMM.exec(hhmm ?? '')
  if (!match) throw new ClaseInvalidaError(`Hora inválida "${hhmm}", se espera "HH:mm"`)
  return Number(match[1]) * 60 + Number(match[2])
}

/** 1110 → "18:30". */
export function aHoraHHmm(minutos) {
  const hh = String(Math.floor(minutos / 60)).padStart(2, '0')
  const mm = String(minutos % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

function hhmmId(minutos) {
  return aHoraHHmm(minutos).replace(':', '')
}

function bloqueCanchaId({ sedeId, canchaId, fecha, minuto }) {
  return `${sedeId}_${canchaId}_${fecha}_${hhmmId(minuto)}`
}

function bloqueProfesorId({ profesorId, fecha, minuto }) {
  return `prof_${profesorId}_${fecha}_${hhmmId(minuto)}`
}

/**
 * Lista de bloques que ocupa una clase, en orden. Cada bloque trae su ID
 * determinista y los campos del documento. Función pura: no toca Firestore.
 * Se exporta para poder probar el cálculo sin base de datos.
 */
export function bloquesDeClase({ sedeId, canchaId, profesorId, fecha, horaInicio, horaFin }) {
  if (!RE_FECHA.test(fecha ?? '')) {
    throw new ClaseInvalidaError(`Fecha inválida "${fecha}", se espera "YYYY-MM-DD"`)
  }
  if (!sedeId) throw new ClaseInvalidaError('Falta sedeId')
  if (!canchaId) throw new ClaseInvalidaError('Falta canchaId')
  if (!profesorId) throw new ClaseInvalidaError('Falta profesorId')

  const inicio = aMinutos(horaInicio)
  const fin = aMinutos(horaFin)
  if (fin <= inicio) {
    throw new ClaseInvalidaError(`horaFin (${horaFin}) debe ser posterior a horaInicio (${horaInicio})`)
  }
  if (inicio % MINUTOS_BLOQUE !== 0) {
    // Sin esto, una clase que arranca a las 19:15 bloquearía bloques 19:15/19:45
    // y no chocaría con una que ocupa 18:00-19:30, aunque en la realidad se
    // pisan de 19:15 a 19:30.
    throw new ClaseInvalidaError(
      `horaInicio debe caer en un múltiplo de ${MINUTOS_BLOQUE} minutos (recibido "${horaInicio}")`,
    )
  }
  if ((fin - inicio) % MINUTOS_BLOQUE !== 0) {
    throw new ClaseInvalidaError(
      `La duración debe ser múltiplo de ${MINUTOS_BLOQUE} minutos (${horaInicio}-${horaFin})`,
    )
  }

  const bloques = []
  for (let minuto = inicio; minuto < fin; minuto += MINUTOS_BLOQUE) {
    const comun = { fecha, minutoInicio: minuto, horaInicio: aHoraHHmm(minuto) }
    bloques.push({
      id: bloqueCanchaId({ sedeId, canchaId, fecha, minuto }),
      data: { ...comun, tipo: 'cancha', sedeId, canchaId, profesorId: null },
    })
    bloques.push({
      id: bloqueProfesorId({ profesorId, fecha, minuto }),
      data: { ...comun, tipo: 'profesor', sedeId: null, canchaId: null, profesorId },
    })
  }
  return bloques
}

/* --------------------------------------------------------------------- */
/* Referencias (internas)                                                  */
/* --------------------------------------------------------------------- */

const refClase = (db, tenantId, claseId) => doc(db, 'academias', tenantId, 'clases', claseId)
const refBloque = (db, tenantId, bloqueId) => doc(db, 'academias', tenantId, 'bloques', bloqueId)

/* --------------------------------------------------------------------- */
/* Lecturas                                                               */
/* --------------------------------------------------------------------- */

/**
 * Devuelve las academias (y el rol) del usuario. Una sola consulta acotada por
 * uid sobre el collection group `miembros`. Requiere el índice de
 * firestore.indexes.json.
 */
export async function getMisMembresias(db, uid) {
  const q = query(collectionGroup(db, 'miembros'), where('uid', '==', uid))
  const snap = await getDocs(q)
  return snap.docs.map((doc) => ({
    tenantId: doc.ref.parent.parent?.id ?? null,
    ...doc.data(),
  }))
}

/*
 * Sedes activas/inactivas de una academia. Acotado por tenant + limit.
 * Se ordena en el cliente por `orden` (evita depender de un índice compuesto
 * y de que el campo exista en todos los documentos).
 */
export async function getSedes(db, tenantId) {
  const q = query(collection(db, 'academias', tenantId, 'sedes'), limit(50))
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((sede) => sede.activa !== false)
    .sort(
      (a, b) =>
        (a.orden ?? 0) - (b.orden ?? 0) ||
        String(a.nombre ?? '').localeCompare(String(b.nombre ?? '')),
    )
}

/** Canchas de una sede. Acotado por sede + limit. Orden client-side por `numero`. */
export async function getCanchas(db, tenantId, sedeId) {
  const q = query(collection(db, 'academias', tenantId, 'sedes', sedeId, 'canchas'), limit(20))
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((cancha) => cancha.activa !== false)
    .sort(
      (a, b) =>
        (a.numero ?? 0) - (b.numero ?? 0) ||
        String(a.nombre ?? '').localeCompare(String(b.nombre ?? '')),
    )
}

/**
 * Profesores activos de una academia. Acotado por tenant + limit. Orden
 * client-side por nombre (evita un índice compuesto).
 */
export async function getProfesores(db, tenantId) {
  const q = query(collection(db, 'academias', tenantId, 'profesores'), limit(50))
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((profesor) => profesor.activo !== false)
    .sort((a, b) => String(a.nombre ?? '').localeCompare(String(b.nombre ?? '')))
}

/**
 * Clases de una sede en UNA fecha, ordenadas por hora. Acotado por
 * tenant + sede + fecha (+ limit). Usa el índice compuesto
 * `clases: sedeId + fecha + horaInicio` de firestore.indexes.json.
 */
export async function getClasesDeSedePorFecha(db, tenantId, sedeId, fecha) {
  const q = query(
    collection(db, 'academias', tenantId, 'clases'),
    where('sedeId', '==', sedeId),
    where('fecha', '==', fecha),
    orderBy('horaInicio'),
    limit(200),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/* --------------------------------------------------------------------- */
/* Reserva sin solapamientos                                              */
/* --------------------------------------------------------------------- */

/**
 * Crea una clase y ocupa todos sus bloques de 30 minutos (cancha + profesor) en
 * UNA transacción. Si algún bloque ya existe, aborta con `SolapamientoError` y
 * no escribe nada.
 *
 * `datos` acepta los campos de `clases/{claseId}` (ver docs/modelo-datos.md §4).
 * Las series fijas (`tipo: 'fija'`) NO están implementadas: sin definir.
 */
export async function crearClase(db, tenantId, datos, opciones = {}) {
  const { uid = null, now = new Date(), claseId = null } = opciones

  if (datos.tipo && datos.tipo !== 'variable') {
    throw new ClaseInvalidaError(
      `Solo se admiten clases "variable"; las series fijas (tipo "${datos.tipo}") están sin definir`,
    )
  }
  validarCategoria(datos.categoria)

  const bloques = bloquesDeClase(datos)
  const claseRef = claseId
    ? refClase(db, tenantId, claseId)
    : doc(collection(db, 'academias', tenantId, 'clases'))

  const clase = {
    tipo: 'variable',
    serieId: null,
    estado: 'reservada',
    categoria: datos.categoria ?? null,
    asistencias: [],
    alumnos: datos.alumnos ?? [],
    alumnoNombres: datos.alumnoNombres ?? [],
    cupo: datos.cupo ?? 4,
    sedeId: datos.sedeId,
    sedeNombre: datos.sedeNombre ?? null,
    canchaId: datos.canchaId,
    profesorId: datos.profesorId,
    profesorNombre: datos.profesorNombre ?? null,
    fecha: datos.fecha,
    horaInicio: datos.horaInicio,
    horaFin: datos.horaFin,
    bloques: bloques.map((b) => b.id),
    creadoPor: uid,
    creadoEn: Timestamp.fromDate(now),
  }

  await runTransaction(db, async (tx) => {
    // Todas las lecturas ANTES de cualquier escritura (requisito de las
    // transacciones de Firestore).
    const snaps = await Promise.all(bloques.map((b) => tx.get(refBloque(db, tenantId, b.id))))
    const ocupado = bloques.find((b, i) => snaps[i].exists())
    if (ocupado) throw new SolapamientoError(ocupado)

    // tx.set() y no create(): la API transaccional del SDK web no tiene create().
    // No importa para la exclusividad — la transacción ya LEYÓ cada bloque, y
    // Firestore reintenta o aborta si alguno cambió entre la lectura y el commit,
    // así que nunca se pisa la reserva ajena.
    tx.set(claseRef, clase)
    for (const bloque of bloques) {
      tx.set(refBloque(db, tenantId, bloque.id), {
        ...bloque.data,
        claseId: claseRef.id,
        creadoPor: uid,
        creadoEn: Timestamp.fromDate(now),
      })
    }
  })

  return { claseId: claseRef.id, bloques: clase.bloques }
}

/**
 * Cancela una clase y libera sus bloques en una sola transacción.
 * Idempotente: cancelar dos veces no falla.
 */
export async function cancelarClase(db, tenantId, claseId, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const claseRef = refClase(db, tenantId, claseId)

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(claseRef)
    if (!snap.exists()) throw new ClaseInvalidaError(`La clase ${claseId} no existe`)
    const datos = snap.data()

    tx.update(claseRef, {
      estado: 'cancelada',
      actualizadoPor: uid,
      actualizadoEn: Timestamp.fromDate(now),
    })
    for (const bloqueId of datos.bloques ?? []) {
      tx.delete(refBloque(db, tenantId, bloqueId))
    }
  })

  return { claseId, estado: 'cancelada' }
}

/**
 * Reprograma una clase en UNA transacción: libera los bloques viejos y ocupa
 * los nuevos, abortando si algún bloque nuevo ya lo ocupa OTRA clase. Los
 * bloques que ya son de la propia clase no cuentan como conflicto (mover una
 * clase sobre sus propios huecos es válido).
 *
 * `nuevoCambio` trae solo los campos a cambiar (fecha, horaInicio, horaFin,
 * canchaId, sedeId, profesorId, …). Los que no vengan se conservan.
 */
export async function reprogramarClase(db, tenantId, claseId, nuevoCambio = {}, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const claseRef = refClase(db, tenantId, claseId)

  if (nuevoCambio.tipo && nuevoCambio.tipo !== 'variable') {
    throw new ClaseInvalidaError(
      `Solo se admiten clases "variable"; las series fijas (tipo "${nuevoCambio.tipo}") están sin definir`,
    )
  }
  validarCategoria(nuevoCambio.categoria)

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(claseRef)
    if (!snap.exists()) throw new ClaseInvalidaError(`La clase ${claseId} no existe`)
    const datos = snap.data()

    const campo = (clave, fallback) =>
      nuevoCambio[clave] !== undefined ? nuevoCambio[clave] : (datos[clave] ?? fallback)

    const futura = {
      sedeId: campo('sedeId'),
      canchaId: campo('canchaId'),
      profesorId: campo('profesorId'),
      fecha: campo('fecha'),
      horaInicio: campo('horaInicio'),
      horaFin: campo('horaFin'),
    }
    const bloquesNuevos = bloquesDeClase(futura)
    const bloquesViejos = datos.bloques ?? []

    // Todas las lecturas antes de cualquier escritura.
    const snaps = await Promise.all(
      bloquesNuevos.map((b) => tx.get(refBloque(db, tenantId, b.id))),
    )
    const ocupado = bloquesNuevos.find(
      (b, i) => snaps[i].exists() && snaps[i].data().claseId !== claseId,
    )
    if (ocupado) throw new SolapamientoError(ocupado)

    const idsNuevos = new Set(bloquesNuevos.map((b) => b.id))
    for (const bloqueId of bloquesViejos) {
      if (!idsNuevos.has(bloqueId)) tx.delete(refBloque(db, tenantId, bloqueId))
    }
    for (const [indice, bloque] of bloquesNuevos.entries()) {
      // Si ya existe y es de esta misma clase, no hace falta reescribirlo.
      if (!snaps[indice].exists()) {
        tx.set(refBloque(db, tenantId, bloque.id), {
          ...bloque.data,
          claseId,
          creadoPor: uid,
          creadoEn: Timestamp.fromDate(now),
        })
      }
    }

    const cambios = {
      bloques: bloquesNuevos.map((b) => b.id),
      actualizadoPor: uid,
      actualizadoEn: Timestamp.fromDate(now),
    }
    for (const clave of [
      'sedeId',
      'sedeNombre',
      'canchaId',
      'profesorId',
      'profesorNombre',
      'fecha',
      'horaInicio',
      'horaFin',
      'cupo',
      'alumnos',
      'alumnoNombres',
      'categoria',
    ]) {
      if (nuevoCambio[clave] !== undefined) cambios[clave] = nuevoCambio[clave]
    }
    tx.update(claseRef, cambios)
  })

  return { claseId }
}

/**
 * Registra la asistencia de una clase (embebida en el documento, §4) y la deja
 * en "pendiente de cobro" en la misma escritura.
 *
 * La regla de negocio de la ausencia justificada (clase de recuperación vs
 * nota de crédito) está SIN DEFINIR: acá solo se guarda Presente/Ausente y un
 * motivo opcional. Tampoco se generan cargos ni liquidación al profesor,
 * porque el modelo no documenta ese cierre (ver reporte).
 */
export async function registrarAsistencia(db, tenantId, claseId, asistencias, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  if (!Array.isArray(asistencias)) {
    throw new ClaseInvalidaError('asistencias debe ser un arreglo')
  }
  const normalizadas = asistencias.map((registro) => {
    if (!registro?.alumnoId) throw new ClaseInvalidaError('Cada asistencia necesita alumnoId')
    if (!ESTADOS_ASISTENCIA.includes(registro.estado)) {
      throw new ClaseInvalidaError(
        `Estado de asistencia inválido "${registro.estado}". Permitidos: ${ESTADOS_ASISTENCIA.join(', ')}`,
      )
    }
    return {
      alumnoId: registro.alumnoId,
      estado: registro.estado,
      motivo: registro.motivo ?? null,
      registradoPor: uid,
      registradoEn: Timestamp.fromDate(now),
    }
  })

  const claseRef = refClase(db, tenantId, claseId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(claseRef)
    if (!snap.exists()) throw new ClaseInvalidaError(`La clase ${claseId} no existe`)
    if (ESTADOS_CERRADOS.includes(snap.data().estado)) {
      throw new ClaseInvalidaError(
        `La clase ${claseId} ya está cerrada (estado "${snap.data().estado}")`,
      )
    }

    tx.update(claseRef, {
      asistencias: normalizadas,
      estado: 'pendiente_cobro',
      actualizadoPor: uid,
      actualizadoEn: Timestamp.fromDate(now),
    })
  })

  return { claseId, estado: 'pendiente_cobro' }
}

/**
 * Membresía del usuario actual en un tenant. 1 lectura. Sirve para decidir qué
 * acciones mostrar en la UI (la autorización real la hacen las Security Rules).
 */
export async function getMiMembresia(db, tenantId, uid) {
  const snap = await getDoc(doc(db, 'academias', tenantId, 'miembros', uid))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/** Lee una clase. 1 lectura. */export async function getClase(db, tenantId, claseId) {
  const snap = await getDoc(refClase(db, tenantId, claseId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() }
}

/**
 * Estado de ocupación de un bloque concreto de 30 minutos. Útil para pintar la
 * grilla de la agenda sin traer todas las clases del día. 1 lectura.
 */
export async function getBloque(db, tenantId, bloqueId) {
  const snap = await getDoc(refBloque(db, tenantId, bloqueId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}