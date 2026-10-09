import { DIAS_CORTOS, DIAS_LARGOS, diaSemana } from './fechas.js'

/*
 * Helpers puros de la agenda: horario de las sedes, grilla horaria, estados y
 * avatares. No tocan Firestore; la página les pasa las clases ya leídas.
 */

/**
 * Franja de UN día, en MINUTOS desde medianoche: 07:00-23:00 por defecto. Los
 * valores guardados en una sede son múltiplos de MINUTOS_BLOQUE, así una sede
 * puede abrir a las 7:30. Ver `horarioDeSede`.
 */
export const HORARIO_DEFAULT = Object.freeze({ apertura: 7 * 60, cierre: 23 * 60 })

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

/** Minutos de un día completo (24:00). Tope de la apertura/cierre de una sede. */
export const MINUTOS_DIA = 24 * 60

/*
 * Último minuto en que puede TERMINAR una clase: 23:30 (1410). El formato
 * "HH:mm" no expresa las 24:00, así que 1410 es el fin más grande que se puede
 * guardar/leer; una sede que cierra a las 24:00 admite clases hasta las 23:30 y
 * la grilla dibuja hasta ahí (nunca ofrece un inicio que daría "24:00").
 */
export const ULTIMO_FIN_CLASE = MINUTOS_DIA - MINUTOS_BLOQUE

/**
 * Días de la semana en el orden del MODELO y de la UI: 0 = lunes … 6 = domingo.
 * Es el mismo índice de `diaSemana`/`DIAS_CORTOS` de src/lib/fechas.js, así que
 * el horario de una sede es un mapa con estas 7 claves: cada valor es una franja
 * en minutos o `null` si la sede está cerrada ese día.
 */
export const DIAS_SEMANA = Object.freeze([0, 1, 2, 3, 4, 5, 6])

/** Los 7 días abiertos con la franja por defecto (07:00-23:00). */
export const HORARIO_SEMANA_DEFAULT = Object.freeze(
  Object.fromEntries(DIAS_SEMANA.map((dia) => [dia, HORARIO_DEFAULT])),
)

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/
const RE_HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Normaliza la franja de UN día (minutos): apertura y cierre enteros, múltiplos
 * de MINUTOS_BLOQUE, dentro de 0-1440 y con cierre > apertura. Devuelve una
 * franja nueva o `null` si el valor no sirve. `null` NO es una franja inválida:
 * significa "día cerrado" y lo resuelve `horarioDelDia`.
 *
 * Es TOLERANTE con campos de más (solo mira `apertura` y `cierre`): así una sede
 * con datos viejos o ensuciados sigue abriendo. La escritura es más estricta y
 * vive en `validarHorario` de src/firebase/db.js, que exige exactamente
 * `{apertura, cierre}` y rechaza campos extra (igual que firestore.rules).
 */
export function franjaValida(franja) {
  const apertura = franja?.apertura
  const cierre = franja?.cierre
  if (!Number.isInteger(apertura) || !Number.isInteger(cierre)) return null
  if (apertura < 0 || apertura % MINUTOS_BLOQUE !== 0) return null
  if (cierre > MINUTOS_DIA || cierre % MINUTOS_BLOQUE !== 0) return null
  if (cierre <= apertura) return null
  return { apertura, cierre }
}

/** Mapa de los 7 días de una sede, o `null` si no tiene el formato por día. */
function semanaValida(horario) {
  if (!horario || typeof horario !== 'object' || Array.isArray(horario)) return null
  if (Object.keys(horario).length !== DIAS_SEMANA.length) return null
  const semana = {}
  for (const dia of DIAS_SEMANA) {
    if (!Object.hasOwn(horario, dia)) return null
    const valor = horario[dia]
    if (valor === null) {
      semana[dia] = null
      continue
    }
    const franja = franjaValida(valor)
    if (!franja) return null
    semana[dia] = franja
  }
  return semana
}

/**
 * Formato VIEJO de una sede: `{apertura, cierre}` en HORAS enteras 0-24.
 * Devuelve la franja equivalente en minutos, o `null` si no lo es.
 */
function franjaHeredada(horario) {
  if (!horario || typeof horario !== 'object' || Array.isArray(horario)) return null
  const apertura = horario.apertura
  const cierre = horario.cierre
  if (!Number.isInteger(apertura) || !Number.isInteger(cierre)) return null
  if (apertura < 0 || apertura > 24 || cierre < 0 || cierre > 24) return null
  if (cierre <= apertura) return null
  return { apertura: apertura * 60, cierre: cierre * 60 }
}

/**
 * Mapa de los 7 días con el horario efectivo de una sede, con claves 0 (lunes) a
 * 6 (domingo). Cada día es `{apertura, cierre}` en MINUTOS o `null` (cerrado).
 *
 * Compatibilidad: si la sede trae el formato viejo (un solo par de horas
 * enteras) se EXPANDE a los 7 días con ese mismo horario. Si falta el campo o
 * está corrupto, se cae al default 07:00-23:00 todos los días, así las sedes
 * viejas siguen funcionando.
 *
 * Es pura y vive acá (no en la capa de datos) porque la usan la grilla de la
 * agenda, el formulario de reserva y la validación de `db.js` por igual.
 */
export function horarioDeSede(sede) {
  const horario = sede?.horario
  const semana = semanaValida(horario)
  if (semana) return semana
  const heredado = franjaHeredada(horario)
  if (heredado) {
    return Object.fromEntries(DIAS_SEMANA.map((dia) => [dia, { ...heredado }]))
  }
  return { ...HORARIO_SEMANA_DEFAULT }
}

/**
 * Día de la semana de una fecha "YYYY-MM-DD" con partes LOCALES (nunca
 * `toISOString()`: con Caracas, UTC-4, adelantaría el día). Mismo índice que
 * `diaSemana` de src/lib/fechas.js: 0 = lunes … 6 = domingo. `null` si la fecha
 * no es válida o no existe (2026-02-31).
 */
export function diaDeFecha(fecha) {
  const match = RE_FECHA.exec(String(fecha ?? '').trim())
  if (!match) return null
  const [y, mes, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(y, mes - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mes - 1 || date.getDate() !== d) {
    return null
  }
  return diaSemana(String(fecha).trim())
}

/**
 * Franja de la sede para UNA fecha concreta: `{apertura, cierre}` en minutos, o
 * `null` si ese día está CERRADO (no admite reservas ni ofrece huecos). Es la
 * utilidad que consultan la grilla, el formulario de reserva y `db.js`.
 */
export function horarioDelDia(fecha, horarioSemana) {
  const dia = diaDeFecha(fecha)
  if (dia === null) return null
  const semana = semanaValida(horarioSemana) ?? horarioDeSede({ horario: horarioSemana })
  const franja = semana[dia]
  return franja ? { ...franja } : null
}

/** Rótulo del día: 0 = lunes → "Lunes". Cadena vacía si el día no existe. */
export function etiquetaDia(dia) {
  if (!Number.isInteger(dia) || dia < 0 || dia > 6) return ''
  return capitalizar(DIAS_LARGOS[(dia + 1) % 7])
}

/** Rótulo corto del día: 0 = lunes → "Lu" (mismo orden que `DIAS_CORTOS`). */
export function etiquetaDiaCorto(dia) {
  return DIAS_CORTOS[dia] ?? ''
}

/** "7:30 AM" de unos minutos desde medianoche. Solo presentación. */
export function formatMinutos(minutos) {
  if (!Number.isInteger(minutos) || minutos < 0 || minutos > MINUTOS_DIA) {
    return formatHora12(minutos)
  }
  return formatHora12(aHoraHHmm(minutos))
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
 * CATEGORÍA DE GRUPO de la clase (opcional y DISTINTA del nivel/categoría de
 * arriba: Principiante, 7ª…1ª): infantil | junior | adulto, o `null` si no se
 * indica. La valida la capa de datos (src/firebase/db.js) contra esta misma
 * lista. Todavía no afecta precios.
 */
export const CATEGORIAS_GRUPO = ['infantil', 'junior', 'adulto']

/** Única tabla de rótulos de categoría de grupo que ve el usuario. */
const ETIQUETAS_CATEGORIA_GRUPO = {
  infantil: 'Infantil',
  junior: 'Junior',
  adulto: 'Adulto',
}

export function etiquetaCategoriaGrupo(categoriaGrupo) {
  if (!categoriaGrupo) return null
  return ETIQUETAS_CATEGORIA_GRUPO[categoriaGrupo] ?? capitalizar(categoriaGrupo)
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

/** Redondea HACIA ABAJO a la grilla de bloques (múltiplo de MINUTOS_BLOQUE). */
export function aBloqueDeGrilla(minutos) {
  return Math.floor(minutos / MINUTOS_BLOQUE) * MINUTOS_BLOQUE
}

/** Redondea HACIA ARRIBA a la grilla de bloques (múltiplo de MINUTOS_BLOQUE). */
export function aBloqueDeGrillaArriba(minutos) {
  return Math.ceil(minutos / MINUTOS_BLOQUE) * MINUTOS_BLOQUE
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

/**
 * Rango vertical que dibuja la grilla de la agenda, en MINUTOS desde
 * medianoche: `{minutoInicio, minutoFin}`. Con esto la grilla puede arrancar en
 * la apertura EXACTA de la sede (p. ej. 7:30) y terminar en su cierre exacto.
 *
 * - `franja` es el horario del DÍA que se está viendo (`{apertura, cierre}` en
 *   minutos, ver `horarioDelDia`) o `null` si la sede está cerrada ese día. Si
 *   falta o está corrupta, se usa el default 07:00-23:00.
 * - El fin se recorta a `ULTIMO_FIN_CLASE` (23:30): el eje no puede rotular las
 *   24:00 y la reserva tampoco puede terminar ahí.
 * - Un día CERRADO no tiene franja propia, así que se dibuja el rango default
 *   como fondo neutro (la pantalla avisa que la sede está cerrada y no ofrece
 *   huecos: ver `opcionesDeInicio` con `null`).
 * - Si alguna clase NO cancelada de las que se están mostrando empieza antes del
 *   inicio o termina después del fin, el rango se AGRANDA para incluirla: una
 *   clase guardada nunca queda invisible. Las canceladas no agrandan nada.
 *
 * Es pura y no lee Firestore: el llamador le pasa las clases de la vista.
 */
export function rangoHorasAgenda(franja, clasesDeLaSemana = []) {
  const abierto = franja === null ? null : franjaValida(franja)
  const base = abierto ?? HORARIO_DEFAULT
  let minutoInicio = base.apertura
  let minutoFin = Math.min(base.cierre, ULTIMO_FIN_CLASE)

  for (const clase of clasesDeLaSemana ?? []) {
    if (clase?.estado === 'cancelada') continue
    const rango = rangoClase(clase)
    if (!rango) continue
    // Se redondea hacia AFUERA al bloque de 30 min: las líneas y las etiquetas de
    // la grilla caen cada MINUTOS_BLOQUE, no solo en la hora en punto.
    if (rango.inicio < minutoInicio) minutoInicio = aBloqueDeGrilla(rango.inicio)
    if (rango.fin > minutoFin) minutoFin = aBloqueDeGrillaArriba(rango.fin)
  }

  // Con una sede abierta 23:30-24:00 el recorte a ULTIMO_FIN_CLASE dejaría el
  // rango vacío: se garantiza una fila.
  if (minutoFin <= minutoInicio) {
    minutoFin = Math.min(minutoInicio + MINUTOS_BLOQUE, MINUTOS_DIA)
  }

  return { minutoInicio, minutoFin }
}

/*
 * Minutos de INICIO que admite una clase, según su duración (en minutos) y el
 * horario del DÍA (en minutos): en punto o a y media (paso de MINUTOS_BLOQUE),
 * desde la apertura, y sin que la clase termine después del cierre. Es la misma
 * regla que aplica la capa de datos (src/firebase/db.js: duración 60/90/120 y
 * horario del día); acá se usa para armar el selector del formulario. No
 * confundir con el rango que DIBUJA la grilla de la agenda (ver
 * `rangoHorasAgenda`).
 *
 * `franja` es el horario del día `{apertura, cierre}` en minutos: sin argumento
 * (o con un valor corrupto) se usa la franja default 07:00-23:00. Con `null` —día
 * CERRADO— no se ofrece ninguna hora.
 *
 * `ocupadas` (opcional) es la lista de clases ya cargadas del día: si una hora
 * de inicio choca con alguna (misma cancha o mismo profesor, ver
 * `chocaConAlguna`), no se ofrece. El filtro es OPCIONAL: sin lista se devuelven
 * todas las horas que caben en la franja, que es lo que necesitan los usos
 * puramente horarios (la grilla, los tests de franja).
 *
 * El formato "HH:mm" no expresa las 24:00, así que el fin de clase nunca puede
 * caer exactamente en la medianoche: con cierre 24:00 la última hora de inicio
 * efectiva es la que termina a las 23:30 (ver ULTIMO_FIN_CLASE).
 */
export function opcionesDeInicio(duracion = 60, franja = undefined, ocupadas = null) {
  const opciones = []
  if (franja === null) return opciones
  const dia = franjaValida(franja) ?? HORARIO_DEFAULT
  const cierre = Math.min(dia.cierre, ULTIMO_FIN_CLASE)
  if (!Number.isFinite(duracion) || duracion <= 0) return opciones
  for (let minuto = dia.apertura; minuto + duracion <= cierre; minuto += MINUTOS_BLOQUE) {
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
  const inicio = Number.isInteger(rango?.minutoInicio) ? rango.minutoInicio : HORARIO_DEFAULT.apertura
  const fin = Number.isInteger(rango?.minutoFin) ? rango.minutoFin : HORARIO_DEFAULT.cierre
  for (let m = inicio; m <= fin; m += MINUTOS_BLOQUE) {
    lineas.push({ minuto: m, horaEntera: m % 60 === 0 })
  }
  return lineas
}

/*
 * Hueco de la grilla a partir de un clic: `minutosDesdeInicioGrilla` son los
 * minutos medidos desde el borde superior de la grilla (`rango.minutoInicio`), no
 * desde la hora en punto, porque el clic puede caer en cualquier punto de la
 * celda. Se redondea HACIA ABAJO al bloque de MINUTOS_BLOQUE: 5:30 PM y 5:59 PM
 * caen los dos en las 5:30 PM, y 5:00 PM en las 5:00 PM. `horaInicio` sale en el
 * mismo formato interno de 24 h ("HH:mm") que usan las opciones del formulario
 * de reserva. Devuelve null si el cálculo no da una hora válida.
 */
export function huecoDeClic({ canchaId, minutosDesdeInicioGrilla, rango }) {
  const minutoInicioGrilla = rango?.minutoInicio
  if (!Number.isInteger(minutoInicioGrilla) || !Number.isFinite(minutosDesdeInicioGrilla)) {
    return null
  }
  const minuto = aBloqueDeGrilla(minutoInicioGrilla + minutosDesdeInicioGrilla)
  if (minuto < 0 || minuto > MINUTOS_DIA - MINUTOS_BLOQUE) return null
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
