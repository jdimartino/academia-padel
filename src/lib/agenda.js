/*
 * Helpers puros de la agenda: grilla horaria, estados y avatares.
 * No tocan Firestore; la página les pasa las clases ya leídas.
 */

/**
 * Franja por defecto de una sede que todavía no tiene el campo `horario`:
 * 07:00-23:00 (ver `horarioDeSede`).
 */
export const HORARIO_DEFAULT = Object.freeze({ apertura: 7, cierre: 23 })

const RE_HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Franja horaria efectiva de una sede. El campo `horario` es
 * `{apertura, cierre}` en HORAS enteras; si falta o está corrupto se cae al
 * default 07:00-23:00, así las sedes viejas (sin el campo) siguen funcionando.
 * Es pura y vive acá (no en la capa de datos) porque la usan la grilla de la
 * agenda, el formulario de reserva y la validación de `db.js` por igual.
 */
export function horarioDeSede(sede) {
  const horario = sede?.horario
  const apertura = Number.isInteger(horario?.apertura) ? horario.apertura : null
  const cierre = Number.isInteger(horario?.cierre) ? horario.cierre : null
  if (
    apertura === null ||
    cierre === null ||
    apertura < 0 ||
    cierre > 24 ||
    cierre <= apertura
  ) {
    return { ...HORARIO_DEFAULT }
  }
  return { apertura, cierre }
}

/** "18:30" → 1110. Devuelve null si no es "HH:mm" válido. */
export function aMinutos(hhmm) {
  const match = RE_HHMM.exec(hhmm ?? '')
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** 1110 → "18:30". */
export function aHoraHHmm(minutos) {
  const hh = String(Math.floor(minutos / 60)).padStart(2, '0')
  const mm = String(minutos % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/*
 * ÚNICO formateador de hora para MOSTRAR al usuario: 12 horas con AM/PM.
 * Acepta una hora entera 0-24 o un string "HH:mm". Es SOLO presentación:
 * los datos guardados, los IDs, las comparaciones y la validación siguen en
 * 24 h ("18:00", 19, …).
 *
 *   7 → "7:00 AM" · 12 → "12:00 PM" · 0 → "12:00 AM" · 24 → "12:00 AM"
 *   "19:00" → "7:00 PM" · "07:30" → "7:30 AM"
 *
 * Sin cero a la izquierda en la hora. Si el valor no es reconocible devuelve el
 * texto original, así una pantalla nunca se rompe por un dato raro.
 */
export function formatHora12(hora) {
  let horas
  let minutos = 0
  if (Number.isInteger(hora)) {
    horas = hora
  } else {
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(hora ?? '').trim())
    if (!match) return String(hora ?? '')
    horas = Number(match[1])
    minutos = Number(match[2])
  }
  if (horas < 0 || horas > 24) return String(hora ?? '')
  // 24 h es la medianoche del día siguiente; se muestra como las 12:00 AM.
  const h24 = horas % 24
  const sufijo = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(minutos).padStart(2, '0')} ${sufijo}`
}

/** Minutos de inicio/fin de una clase, recortados a la franja visible. */
export function rangoClase(clase) {
  const inicio = aMinutos(clase.horaInicio)
  const fin = aMinutos(clase.horaFin)
  if (inicio === null || fin === null || fin <= inicio) return null
  return { inicio, fin }
}

/*
 * Mapa de estado almacenado → rótulo + tono visual.
 * Estados del modelo (docs/modelo-datos.md §4): reservada, ejecutada,
 * pendiente_cobro, cobrada, cancelada.
 * Tono visual: reservada | ejecutada | pendiente | cancelada.
 * `cobrada` no tiene un estado visual propio: se pinta como ejecutada
 * (el trabajo ya se hizo); el rótulo sí dice "Cobrada".
 */
const ESTADOS = {
  reservada: { label: 'Reservada', tono: 'reservada' },
  ejecutada: { label: 'Ejecutada', tono: 'ejecutada' },
  pendiente_cobro: { label: 'Pendiente de cobro', tono: 'pendiente' },
  cobrada: { label: 'Cobrada', tono: 'ejecutada' },
  cancelada: { label: 'Cancelada', tono: 'cancelada' },
}

export function estadoDe(estado) {
  return ESTADOS[estado] ?? { label: capitalizar(estado ?? 'Sin estado'), tono: 'reservada' }
}

export function capitalizar(texto) {
  const t = String(texto ?? '')
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

/*
 * Categoría de la clase (opcional). El id guardado NO cambia ("7a",
 * "principiante"); la etiqueta que ve el usuario se centraliza acá:
 * Principiante, 1ra, 2da, 3ra, 4ta, 5ta, 6ta, 7ma.
 * Ver docs/modelo-datos.md §4.
 */
export const CATEGORIAS = ['principiante', '7a', '6a', '5a', '4a', '3a', '2a', '1a']

/** Única tabla de rótulos de nivel/categoría que ve el usuario. */
const ETIQUETAS_CATEGORIA = {
  principiante: 'Principiante',
  '1a': '1ra',
  '2a': '2da',
  '3a': '3ra',
  '4a': '4ta',
  '5a': '5ta',
  '6a': '6ta',
  '7a': '7ma',
}

export function etiquetaCategoria(categoria) {
  if (!categoria) return null
  return ETIQUETAS_CATEGORIA[categoria] ?? capitalizar(categoria)
}

/*
 * Modalidad derivada del cupo (no es un campo aparte): una clase de una sola
 * plaza es Individual; con dos o más, Grupal.
 */
export function modalidadDeClase(clase) {
  return (clase.cupo ?? 0) <= 1 ? 'Individual' : 'Grupal'
}

/** Título del bloque: "Modalidad · Categoría" (solo modalidad si no hay categoría). */
export function tituloClase(clase) {
  return [modalidadDeClase(clase), etiquetaCategoria(clase.categoria)].filter(Boolean).join(' · ')
}

/*
 * "Sin cerrar": una clase que quedó `reservada` y cuya hora de fin YA pasó, es
 * decir que se dictó (o debía dictarse) y nadie registró la asistencia.
 * Se compara en calendario/hora LOCAL. Nunca se usa toISOString(): pasaría a
 * UTC y con Caracas (UTC-4) adelantaría el día. `ahora` es inyectable para
 * poder probarlo.
 */
export function estaSinCerrar(clase, ahora = new Date()) {
  if (clase?.estado !== 'reservada' || !clase.fecha) return false
  const fin = aMinutos(clase.horaFin)
  if (fin === null) return false
  const [y, m, d] = String(clase.fecha).split('-').map(Number)
  if (!y || !m || !d) return false
  const finFecha = new Date(y, m - 1, d, 0, 0, 0, 0)
  finFecha.setMinutes(fin)
  return finFecha.getTime() < ahora.getTime()
}

/** Cantidad de clases "sin cerrar" en una lista. */
export function contarSinCerrar(clases, ahora = new Date()) {
  return (clases ?? []).filter((clase) => estaSinCerrar(clase, ahora)).length
}

/** "Pablo Profesor" → "PP" (máximo 2 iniciales). */
export function iniciales(nombre) {
  const partes = String(nombre ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

/** Horas enteras de la franja, para las etiquetas de la grilla. */
export function horasDeFranja(rango) {
  const horas = []
  for (let h = rango.horaInicio; h <= rango.horaFin; h += 1) horas.push(h)
  return horas
}

/*
 * Última hora en la que puede TERMINAR una clase. El formato "HH:mm" no expresa
 * las 24:00, así que con una sede que cierra a las 24 la última clase termina
 * igual a las 23:00. Es el mismo fin efectivo que usa la validación de reservas.
 */
export const HORA_CIERRE_CLASE = 23

/**
 * Rango vertical (en horas enteras) que dibuja la grilla de la agenda:
 * `{horaInicio, horaFin}`.
 *
 * - Arranca en la apertura de la sede y termina en `min(cierre, 23)`, el mismo
 *   fin efectivo que aplica la validación de reservas (ver HORA_CIERRE_CLASE).
 * - `horario` es el `{apertura, cierre}` de la sede; si falta o está corrupto se
 *   usa el default 07:00-23:00 (ver `horarioDeSede`).
 * - Si alguna clase NO cancelada de las que se están mostrando empieza antes del
 *   inicio o termina después del fin, el rango se AGRANDA para incluirla: una
 *   clase guardada nunca queda invisible. Las canceladas no agrandan nada.
 *
 * Es pura y no lee Firestore: el llamador le pasa las clases de la vista.
 */
export function rangoHorasAgenda(horario, clasesDeLaSemana = []) {
  const franja = horarioDeSede({ horario })
  let horaInicio = franja.apertura
  let horaFin = Math.min(franja.cierre, HORA_CIERRE_CLASE)

  for (const clase of clasesDeLaSemana ?? []) {
    if (clase?.estado === 'cancelada') continue
    const rango = rangoClase(clase)
    if (!rango) continue
    // Se redondea hacia afuera porque la grilla se dibuja por horas enteras.
    if (rango.inicio < horaInicio * 60) horaInicio = Math.floor(rango.inicio / 60)
    const finEnHoras = Math.ceil(rango.fin / 60)
    if (finEnHoras > horaFin) horaFin = finEnHoras
  }

  return { horaInicio, horaFin }
}

/*
 * Horas de INICIO que admite una clase, según su duración (en minutos) y la
 * franja de la sede (horas enteras): solo horas en punto, desde la apertura, y
 * sin que la clase termine después del cierre. Es la misma regla que aplica la
 * capa de datos (src/firebase/db.js: duración 1 h o 2 h y horario de la sede);
 * acá se usa para armar el selector del formulario. No confundir con el rango
 * que DIBUJA la grilla de la agenda (ver `rangoHorasAgenda`).
 *
 * `horario` es `{apertura, cierre}` en horas enteras (el de la sede). Sin él se
 * usa la franja histórica 07:00-23:00.
 *
 * El formato "HH:mm" no expresa las 24:00, así que el fin de clase nunca puede
 * caer exactamente en la medianoche: con cierre 24 la última hora de inicio
 * efectiva es la que termina a las 23:00 (igual que con cierre 23).
 */
export function opcionesDeInicio(duracion = 60, horario = null) {
  const opciones = []
  const apertura = (Number.isInteger(horario?.apertura) ? horario.apertura : HORARIO_DEFAULT.apertura) * 60
  const cierreHoras = Number.isInteger(horario?.cierre) ? horario.cierre : HORA_CIERRE_CLASE
  const cierre = Math.min(cierreHoras, HORA_CIERRE_CLASE) * 60
  if (!Number.isFinite(duracion) || duracion <= 0) return opciones
  for (let minuto = apertura; minuto + duracion <= cierre; minuto += 60) {
    opciones.push(aHoraHHmm(minuto))
  }
  return opciones
}

/** Líneas de fondo: cada 30 min, marcando cuáles son hora en punto. */
export function lineasDeFranja(rango) {
  const lineas = []
  for (let m = rango.horaInicio * 60; m <= rango.horaFin * 60; m += 30) {
    lineas.push({ minuto: m, horaEntera: m % 60 === 0 })
  }
  return lineas
}
