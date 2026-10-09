/*
 * Helpers puros de la agenda: grilla horaria, estados y avatares.
 * No tocan Firestore; la página les pasa las clases ya leídas.
 */

/**
 * Franja por defecto de una sede que todavía no tiene el campo `horario`:
 * 07:00-23:00 (ver `horarioDeSede`).
 */
export const HORARIO_DEFAULT = Object.freeze({ apertura: 7, cierre: 23 })

/**
 * Granularidad de la ocupación: 30 minutos. ÚNICA definición del tamaño de
 * bloque del proyecto: de acá la reexporta la capa de datos (src/firebase/db.js)
 * para los IDs deterministas y el solapamiento, y de acá la toman la grilla y el
 * formulario de reserva. Nada de 30 repetido a mano.
 * Ver docs/modelo-datos.md §4.1.
 */
export const MINUTOS_BLOQUE = 30

/**
 * Duraciones de clase admitidas, en minutos. La capa de datos valida contra esta
 * misma lista, así el formulario y la transacción nunca se contradicen.
 */
export const DURACIONES_VALIDAS = [60, 90, 120]

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
 * Instante local (calendario del negocio) de una fecha "YYYY-MM-DD" más unos
 * minutos del día. Mismo criterio que `instanteLocal` de la capa de datos
 * (src/firebase/db.js): se usan las partes LOCALES del Date, nunca
 * toISOString() — con Caracas (UTC-4) UTC adelantaría el día. Devuelve null si
 * la fecha no es válida.
 */
function instanteDeFecha(fecha, minutos) {
  const [y, m, d] = String(fecha ?? '').split('-').map(Number)
  if (!y || !m || !d) return null
  const instante = new Date(y, m - 1, d, 0, 0, 0, 0)
  instante.setMinutes(minutos)
  return instante
}

/*
 * "Sin cerrar": una clase que quedó `reservada` y cuya hora de fin YA pasó, es
 * decir que se dictó (o debía dictarse) y nadie registró la asistencia.
 * Se compara en calendario/hora LOCAL. `ahora` es inyectable para poder
 * probarlo.
 */
export function estaSinCerrar(clase, ahora = new Date()) {
  if (clase?.estado !== 'reservada' || !clase.fecha) return false
  const fin = aMinutos(clase.horaFin)
  if (fin === null) return false
  const finFecha = instanteDeFecha(clase.fecha, fin)
  if (!finFecha) return false
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

/** Redondea HACIA ABAJO a la grilla de bloques (múltiplo de MINUTOS_BLOQUE). */
export function aBloqueDeGrilla(minutos) {
  return Math.floor(minutos / MINUTOS_BLOQUE) * MINUTOS_BLOQUE
}

/**
 * Rótulo humano de una duración en minutos: "1 h", "1 h 30 min", "2 h".
 * Es SOLO presentación: los datos, la validación y los IDs siguen en minutos.
 */
export function etiquetaDuracion(minutos) {
  const total = Number(minutos)
  if (!Number.isFinite(total) || total <= 0) return ''
  const horas = Math.floor(total / 60)
  const resto = total % 60
  if (horas === 0) return `${resto} min`
  if (resto === 0) return `${horas} h`
  return `${horas} h ${resto} min`
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
    // Se redondea hacia afuera a la hora: las ETIQUETAS de la grilla son horas
    // enteras (las líneas finas de media hora van dentro de cada hora).
    if (rango.inicio < horaInicio * 60) horaInicio = Math.floor(rango.inicio / 60)
    const finEnHoras = Math.ceil(rango.fin / 60)
    if (finEnHoras > horaFin) horaFin = finEnHoras
  }

  return { horaInicio, horaFin }
}

/*
 * Horas de INICIO que admite una clase, según su duración (en minutos) y la
 * franja de la sede (horas enteras): en punto o a y media (paso de
 * MINUTOS_BLOQUE), desde la apertura, y sin que la clase termine después del
 * cierre. Es la misma regla que aplica la capa de datos (src/firebase/db.js:
 * duración 60/90/120 y horario de la sede); acá se usa para armar el selector
 * del formulario. No confundir con el rango que DIBUJA la grilla de la agenda
 * (ver `rangoHorasAgenda`).
 *
 * `horario` es `{apertura, cierre}` en horas enteras (el de la sede). Sin él se
 * usa la franja histórica 07:00-23:00.
 *
 * `ocupadas` (opcional) es la lista de clases ya cargadas del día: si una hora
 * de inicio choca con alguna (misma cancha o mismo profesor, ver
 * `chocaConAlguna`), no se ofrece. El filtro es OPCIONAL: sin lista se devuelven
 * todas las horas que caben en la franja, que es lo que necesitan los usos
 * puramente horarios (la grilla, los tests de franja).
 *
 * El formato "HH:mm" no expresa las 24:00, así que el fin de clase nunca puede
 * caer exactamente en la medianoche: con cierre 24 la última hora de inicio
 * efectiva es la que termina a las 23:00 (igual que con cierre 23).
 */
export function opcionesDeInicio(duracion = 60, horario = null, ocupadas = null) {
  const opciones = []
  const apertura =
    (Number.isInteger(horario?.apertura) ? horario.apertura : HORARIO_DEFAULT.apertura) * 60
  const cierreHoras = Number.isInteger(horario?.cierre) ? horario.cierre : HORA_CIERRE_CLASE
  const cierre = Math.min(cierreHoras, HORA_CIERRE_CLASE) * 60
  if (!Number.isFinite(duracion) || duracion <= 0) return opciones
  for (let minuto = apertura; minuto + duracion <= cierre; minuto += MINUTOS_BLOQUE) {
    if (ocupadas && chocaConAlguna(ocupadas, minuto, minuto + duracion)) continue
    opciones.push(aHoraHHmm(minuto))
  }
  return opciones
}

/**
 * ¿El rango [inicio, fin) choca con alguna de las clases dadas? Mismo criterio
 * que la validación de la capa de datos y que el formulario: se solapan si
 * `inicio < otroFin && otroInicio < fin`. El borde exacto (una clase que termina
 * justo cuando empieza la otra) NO es choque. Las canceladas no ocupan nada y
 * una clase con horas corruptas se ignora.
 */
export function chocaConAlguna(clases, inicio, fin) {
  return (clases ?? []).some((clase) => {
    if (clase?.estado === 'cancelada') return false
    const otroInicio = aMinutos(clase?.horaInicio)
    const otroFin = aMinutos(clase?.horaFin)
    if (otroInicio === null || otroFin === null) return false
    return otroInicio < fin && inicio < otroFin
  })
}

/**
 * Líneas de fondo de la grilla: cada MINUTOS_BLOQUE (30) minutos. `horaEntera`
 * distingue las líneas de hora en punto (más marcadas) de las de media hora.
 */
export function lineasDeFranja(rango) {
  const lineas = []
  for (
    let m = rango.horaInicio * 60;
    m <= rango.horaFin * 60;
    m += MINUTOS_BLOQUE
  ) {
    lineas.push({ minuto: m, horaEntera: m % 60 === 0 })
  }
  return lineas
}

/*
 * Hueco de la grilla a partir de un clic: `minutosDesdeInicioGrilla` son los
 * minutos medidos desde el borde superior de la grilla (`rango.horaInicio`), no
 * desde la hora en punto, porque el clic puede caer en cualquier punto de la
 * celda. Se redondea HACIA ABAJO al bloque de MINUTOS_BLOQUE: 5:30 PM y 5:59 PM
 * caen los dos en las 5:30 PM, y 5:00 PM en las 5:00 PM. `horaInicio` sale en el
 * mismo formato interno de 24 h ("HH:mm") que usan las opciones del formulario
 * de reserva. Devuelve null si el cálculo no da una hora válida.
 */
export function huecoDeClic({ canchaId, minutosDesdeInicioGrilla, rango }) {
  const horasGrilla = rango?.horaInicio
  if (!Number.isInteger(horasGrilla) || !Number.isFinite(minutosDesdeInicioGrilla)) return null
  const minuto = aBloqueDeGrilla(horasGrilla * 60 + minutosDesdeInicioGrilla)
  if (minuto < 0) return null
  return { canchaId, horaInicio: aHoraHHmm(minuto) }
}

/*
 * ¿Se puede reservar todavía ese hueco? Misma regla que la validación de la
 * capa de datos (`validarInicioNoPasado` en src/firebase/db.js): el borde
 * exacto (inicio === ahora) SÍ se admite, solo es pasado lo anterior. `ahora`
 * es inyectable para poder probarlo.
 */
export function esHuecoReservable(hueco, fecha, ahora = new Date()) {
  const minutos = aMinutos(hueco?.horaInicio)
  if (minutos === null) return false
  const inicio = instanteDeFecha(fecha, minutos)
  if (!inicio) return false
  return inicio.getTime() >= ahora.getTime()
}

/*
 * ¿El hueco está LIBRE? Una clase no cancelada de esa cancha que se solape con
 * el bloque lo ocupa; una cancelada NO ocupa nada (la cancha queda libre aunque
 * el bloque siga dibujado en la grilla). El hueco abarca un bloque de
 * MINUTOS_BLOQUE (30) minutos, que es lo que dura la celda clicable.
 */
export function huecoLibre(clases, hueco) {
  const inicio = aMinutos(hueco?.horaInicio)
  if (!hueco || inicio === null) return false
  const fin = inicio + MINUTOS_BLOQUE
  return !(clases ?? []).some((clase) => {
    if (clase?.canchaId !== hueco.canchaId || clase.estado === 'cancelada') return false
    const rango = rangoClase(clase)
    if (!rango) return false
    return rango.inicio < fin && inicio < rango.fin
  })
}
