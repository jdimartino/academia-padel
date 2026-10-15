/*
 * Reportes (Parte B): módulo PURO de agregación y exportación.
 * Sin React y sin Firestore: recibe los datos ya cargados por la capa de datos
 * (src/firebase/db.js) y devuelve tablas listas para mostrar o exportar. Toda
 * función es determinista (recibe `ahora` cuando depende del tiempo) para poder
 * testearla sin emulador.
 *
 * Convenciones:
 * - Los montos son SIEMPRE centavos de USD enteros (nunca se convierten al
 *   agregar: la equivalencia Bs/EUR es solo de presentación).
 * - Las fechas son "YYYY-MM-DD" locales.
 * - El CSV es compatible con Excel: BOM UTF-8, separador ';' y montos como
 *   números en USD (con punto decimal).
 */

import { formatearFechaLarga, hoyISO, sumarDias, diaSemana } from './fechas.js'
import { aMinutos, horarioDelDia } from './agenda.js'
import { formatearUSD } from './dinero.js'

/* ------------------------------------------------------------------ */
/* Utilidades de agregación                                            */
/* ------------------------------------------------------------------ */

/** Suma de centavos de una lista de objetos con la clave dada. */
export function sumarCents(lista, clave = 'montoCents') {
  return (lista ?? []).reduce((total, item) => total + (Number(item?.[clave]) || 0), 0)
}

/** ¿La fecha "YYYY-MM-DD" cae dentro de [desde, hasta] (inclusive, ambos opcionales)? */
export function enRango(fecha, desde, hasta) {
  if (!fecha) return false
  if (desde && fecha < desde) return false
  if (hasta && fecha > hasta) return false
  return true
}

/** Agrupa una lista por el resultado de `clave(item)` → Map(clave, items[]). */
export function agruparPor(lista, clave) {
  const mapa = new Map()
  for (const item of lista ?? []) {
    const k = clave(item)
    if (!mapa.has(k)) mapa.set(k, [])
    mapa.get(k).push(item)
  }
  return mapa
}

/** Días entre dos fechas ISO (b - a), en días enteros. */
export function diasEntre(a, b) {
  const [ay, am, ad] = String(a).split('-').map(Number)
  const [by, bm, bd] = String(b).split('-').map(Number)
  const da = Date.UTC(ay, am - 1, ad)
  const db = Date.UTC(by, bm - 1, bd)
  return Math.round((db - da) / 86400000)
}

/** Duración de una clase en minutos (horaFin - horaInicio). */
export function duracionMinutos(clase) {
  const ini = aMinutos(clase?.horaInicio)
  const fin = aMinutos(clase?.horaFin)
  if (ini === null || fin === null) return 0
  return Math.max(0, fin - ini)
}

/* ------------------------------------------------------------------ */
/* Exportación                                                         */
/* ------------------------------------------------------------------ */

/**
 * Normaliza un teléfono venezolano al formato internacional `58...` (solo
 * dígitos), o `null` si no se puede. Acepta: "+58 412-1234567", "0412-1234567",
 * "4121234567", "0058...".
 */
export function normalizarTelefonoVE(telefono) {
  if (!telefono) return null
  let digitos = String(telefono).replace(/\D/g, '')
  if (!digitos) return null
  if (digitos.startsWith('0058')) digitos = digitos.slice(2)
  if (digitos.startsWith('58')) return digitos.length >= 11 ? digitos : null
  if (digitos.startsWith('0')) digitos = digitos.slice(1)
  // Ahora debería empezar por el código de operadora (3 dígitos) + 7 dígitos.
  if (digitos.length === 10) return `58${digitos}`
  return null
}

/** Escapa un valor para CSV: comillas dobles y separador ';'. */
export function escaparCSV(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor)
  if (texto.includes(';') || texto.includes('"') || texto.includes('\n') || texto.includes('\r')) {
    return `"${texto.replace(/"/g, '""')}"`
  }
  return texto
}

const SEPARADOR_CSV = ';'
// BOM UTF-8 para que Excel abra el archivo con acentos correctos.
const BOM = '\uFEFF'

/**
 * Construye un CSV listo para Excel. `columnas` = [{ clave, label }],
 * `filas` = array de objetos. Los valores ya vienen FORMATEADOS desde el
 * llamador (el dinero se pasa como número en USD).
 */
export function aCSV(columnas, filas) {
  const encabezado = columnas.map((c) => escaparCSV(c.label)).join(SEPARADOR_CSV)
  const lineas = (filas ?? []).map((fila) =>
    columnas.map((c) => escaparCSV(fila[c.clave])).join(SEPARADOR_CSV),
  )
  return `${BOM}${[encabezado, ...lineas].join('\r\n')}`
}

/** Descarga un texto como archivo (solo navegador). */
export function descargarTexto(nombre, contenido, tipo = 'text/csv;charset=utf-8') {
  const blob = new Blob([contenido], { type: tipo })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  document.body.removeChild(enlace)
  URL.revokeObjectURL(url)
}

/**
 * Arma el texto corto de WhatsApp (o Compartir). Se mantiene breve: título,
 * rango de fechas y las líneas que el llamador pase (una por concepto), ya
 * formateadas.
 */
export function textoResumen({ titulo, rango, lineas = [], academia = '' }) {
  const partes = []
  if (academia) partes.push(`*${academia}*`)
  partes.push(`*${titulo}*`)
  if (rango) partes.push(rango)
  if (lineas.length) partes.push('')
  partes.push(...lineas)
  return partes.join('\n').trim()
}

/** URL de WhatsApp: a un número puntual o al selector de contacto. */
export function urlWhatsApp(texto, telefono = null) {
  const codificado = encodeURIComponent(texto)
  const destino = telefono ? normalizarTelefonoVE(telefono) : null
  if (destino) return `https://wa.me/${destino}?text=${codificado}`
  return `https://wa.me/?text=${codificado}`
}

/* ------------------------------------------------------------------ */
/* Constructores por informe                                           */
/* ------------------------------------------------------------------ */

/** Fila de una clase → descripción compacta de asistencia. */
function conteoAsistencia(clase) {
  const asistencias = clase?.asistencias ?? []
  const presentes = asistencias.filter((a) => a.estado === 'presente').length
  const avisaron = asistencias.filter((a) => a.estado === 'ausente_avisada').length
  const sinAviso = asistencias.filter((a) => a.estado === 'ausente_sin_aviso').length
  return { presentes, avisaron, sinAviso }
}

const ABIERTA = 'reservada'
const CERRADAS = new Set(['pendiente_cobro', 'cobrada', 'ejecutada'])

/** Índice de clases por fecha+categoria... no necesario; helpers puntuales. */

/** (1) Clases agendadas: próximas (fecha >= hoy) y abiertas. */
export function clasesAgendadas({ clases = [], filtros = {} } = {}) {
  const hoy = filtros.ahora ?? hoyISO()
  // Es un informe de PRÓXIMAS clases: el piso es hoy, no el inicio del rango.
  const desde = filtros.desde && filtros.desde > hoy ? filtros.desde : hoy
  const hasta = filtros.hasta || null
  const filas = clases
    .filter((c) => c.estado === ABIERTA)
    .filter((c) => enRango(c.fecha, desde, hasta))
    .filter((c) => !filtros.profesorId || c.profesorId === filtros.profesorId)
    .sort((a, b) => (a.fecha + a.horaInicio).localeCompare(b.fecha + b.horaInicio))
    .map((c) => ({
      fecha: c.fecha,
      horario: `${c.horaInicio}–${c.horaFin}`,
      sede: c.sedeNombre ?? '',
      cancha: c.canchaNombre ?? '',
      profesor: c.profesorNombre ?? '',
      alumnos: (c.alumnoNombres ?? []).join(', '),
      categoria: c.categoria ?? '',
    }))
  return {
    columnas: [
      { clave: 'fecha', label: 'Fecha', tipo: 'fecha' },
      { clave: 'horario', label: 'Horario' },
      { clave: 'sede', label: 'Sede' },
      { clave: 'cancha', label: 'Cancha' },
      { clave: 'profesor', label: 'Profesor' },
      { clave: 'alumnos', label: 'Alumnos' },
      { clave: 'categoria', label: 'Nivel' },
    ],
    filas,
    totales: { clave: 'fecha', label: 'Clases', valor: filas.length },
  }
}

/** (2) Clases realizadas: cerradas, con el conteo de asistencia. */
export function clasesRealizadas({ clases = [], filtros = {} } = {}) {
  const filas = clases
    .filter((c) => CERRADAS.has(c.estado))
    .filter((c) => enRango(c.fecha, filtros.desde, filtros.hasta))
    .filter((c) => !filtros.profesorId || c.profesorId === filtros.profesorId)
    .sort((a, b) => (b.fecha + b.horaInicio).localeCompare(a.fecha + a.horaInicio))
    .map((c) => {
      const { presentes, avisaron, sinAviso } = conteoAsistencia(c)
      return {
        fecha: c.fecha,
        horario: `${c.horaInicio}–${c.horaFin}`,
        sede: c.sedeNombre ?? '',
        profesor: c.profesorNombre ?? '',
        presentes,
        avisaron,
        sinAviso,
        total: (c.alumnos ?? []).length,
      }
    })
  return {
    columnas: [
      { clave: 'fecha', label: 'Fecha', tipo: 'fecha' },
      { clave: 'horario', label: 'Horario' },
      { clave: 'sede', label: 'Sede' },
      { clave: 'profesor', label: 'Profesor' },
      { clave: 'presentes', label: 'Presentes', tipo: 'numero' },
      { clave: 'avisaron', label: 'Avisaron', tipo: 'numero' },
      { clave: 'sinAviso', label: 'Sin aviso', tipo: 'numero' },
      { clave: 'total', label: 'Total', tipo: 'numero' },
    ],
    filas,
    totales: { clave: 'presentes', label: 'Clases', valor: filas.length },
  }
}

/** (3) Ocupación de canchas: minutos reservados / minutos abiertos. */
export function ocupacionCanchas({ clases = [], sedes = [], canchasPorSede = {}, filtros = {} } = {}) {
  const desde = filtros.desde
  const hasta = filtros.hasta
  if (!desde || !hasta) return { columnas: [], filas: [] }
  const dias = Math.max(1, diasEntre(desde, hasta) + 1)
  const filas = []
  for (const sede of sedes) {
    const horario = sede.horario ?? null
    const canchas = canchasPorSede[sede.id] ?? []
    const clasesSede = clases.filter((c) => c.sedeId === sede.id && c.estado !== 'cancelada')
    // Minutos abiertos por cancha en el rango (según el horario por día).
    let minutosAbiertos = 0
    for (let i = 0; i < dias; i += 1) {
      const fecha = sumarDias(desde, i)
      const franja = horarioDelDia(fecha, horario)
      if (franja) minutosAbiertos += franja.cierre - franja.apertura
    }
    for (const cancha of canchas) {
      const reservados = clasesSede
        .filter((c) => c.canchaId === cancha.id && enRango(c.fecha, desde, hasta))
        .reduce((total, c) => total + duracionMinutos(c), 0)
      const abiertos = minutosAbiertos
      const pct = abiertos > 0 ? Math.round((reservados / abiertos) * 1000) / 10 : 0
      filas.push({
        sede: sede.nombre ?? sede.id,
        cancha: cancha.nombre ?? cancha.id,
        reservados,
        abiertos,
        ocupacion: pct,
      })
    }
  }
  return {
    columnas: [
      { clave: 'sede', label: 'Sede' },
      { clave: 'cancha', label: 'Cancha' },
      { clave: 'reservados', label: 'Min. reservados', tipo: 'numero' },
      { clave: 'abiertos', label: 'Min. abiertos', tipo: 'numero' },
      { clave: 'ocupacion', label: 'Ocupación %', tipo: 'numero' },
    ],
    filas,
  }
}

/** (4) Agenda semanal por profesor. */
export function agendaSemanalProfesor({ clases = [], filtros = {} } = {}) {
  const desde = filtros.desde
  const hasta = filtros.hasta
  const filas = clases
    .filter((c) => c.estado !== 'cancelada' && enRango(c.fecha, desde, hasta))
    .filter((c) => !filtros.profesorId || c.profesorId === filtros.profesorId)
    .sort((a, b) =>
      (a.profesorNombre ?? '').localeCompare(b.profesorNombre ?? '', 'es') ||
      (a.fecha + a.horaInicio).localeCompare(b.fecha + b.horaInicio),
    )
    .map((c) => ({
      profesor: c.profesorNombre ?? '',
      dia: diaSemana(c.fecha),
      fecha: c.fecha,
      horario: `${c.horaInicio}–${c.horaFin}`,
      sede: c.sedeNombre ?? '',
      cancha: c.canchaNombre ?? '',
      alumnos: (c.alumnos ?? []).length,
    }))
  return {
    columnas: [
      { clave: 'profesor', label: 'Profesor' },
      { clave: 'dia', label: 'Día', tipo: 'dia' },
      { clave: 'fecha', label: 'Fecha', tipo: 'fecha' },
      { clave: 'horario', label: 'Horario' },
      { clave: 'sede', label: 'Sede' },
      { clave: 'cancha', label: 'Cancha' },
      { clave: 'alumnos', label: 'Alumnos', tipo: 'numero' },
    ],
    filas,
    totales: { clave: 'profesor', label: 'Clases', valor: filas.length },
  }
}

/** (5) Listado de alumnos. */
export function listadoAlumnos({ alumnos = [], filtros = {} } = {}) {
  const filas = alumnos
    .filter((a) => !filtros.soloActivos || a.activo !== false)
    .map((a) => ({
      nombre: `${a.nombre ?? ''} ${a.apellidos ?? ''}`.trim(),
      contacto: a.telefono || a.email || '',
      nivel: a.nivel ?? '',
      tipo: a.tipo ?? '',
      representante: a.representante ? `${a.representante.nombre ?? ''} ${a.representante.apellidos ?? ''}`.trim() : '',
      estado: a.activo === false ? 'Inactivo' : 'Activo',
    }))
  return {
    columnas: [
      { clave: 'nombre', label: 'Alumno' },
      { clave: 'contacto', label: 'Contacto' },
      { clave: 'nivel', label: 'Nivel' },
      { clave: 'tipo', label: 'Tipo' },
      { clave: 'representante', label: 'Representante' },
      { clave: 'estado', label: 'Estado' },
    ],
    filas,
    totales: { clave: 'nombre', label: 'Alumnos', valor: filas.length },
  }
}

/** (14) Faltas, cortesías y descuentos. */
export function faltasCortesiasDescuentos({ cargos = [], clases = [], filtros = {} } = {}) {
  const clasesPorId = new Map(clases.map((c) => [c.id, c]))
  const filas = []
  for (const clase of clases) {
    if (!enRango(clase.fecha, filtros.desde, filtros.hasta)) continue
    const cobro = clase.cobro
    if (cobro && (cobro.ajustado || cobro.motivoAjuste)) {
      const descuento = (cobro.montoEstandarCents ?? 0) - (cobro.montoCents ?? 0)
      filas.push({
        fecha: clase.fecha,
        tipo: cobro.motivoAjuste === 'cortesia' ? 'Cortesía' : 'Precio editado',
        sede: clase.sedeNombre ?? '',
        detalle: `${clase.horaInicio}–${clase.horaFin}`,
        monto: cobro.montoCents ?? 0,
        diferencia: descuento,
      })
    }
  }
  for (const cargo of cargos) {
    if (cargo.concepto !== 'falta_sin_aviso') continue
    if (!enRango(cargo.fecha, filtros.desde, filtros.hasta)) continue
    const clase = clasesPorId.get(cargo.claseId)
    filas.push({
      fecha: cargo.fecha,
      tipo: 'Falta sin aviso',
      sede: clase?.sedeNombre ?? '',
      detalle: cargo.alumnoNombre ?? '',
      monto: cargo.montoCents ?? 0,
      diferencia: 0,
    })
  }
  filas.sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
  return {
    columnas: [
      { clave: 'fecha', label: 'Fecha', tipo: 'fecha' },
      { clave: 'tipo', label: 'Tipo' },
      { clave: 'sede', label: 'Sede' },
      { clave: 'detalle', label: 'Detalle' },
      { clave: 'monto', label: 'Monto', tipo: 'money' },
      { clave: 'diferencia', label: 'Ahorro', tipo: 'money' },
    ],
    filas,
    totales: { clave: 'monto', label: 'Total', tipo: 'money', valor: sumarCents(filas, 'monto') },
  }
}

/** (6) Planes y crédito. */
export function planesCredito({ planes = [], creditos = [], alumnos = [] } = {}) {
  const alumnoPorId = new Map(alumnos.map((a) => [a.id, a]))
  const creditosPorAlumno = new Map()
  for (const credito of creditos) {
    if (!creditosPorAlumno.has(credito.alumnoId)) creditosPorAlumno.set(credito.alumnoId, [])
    creditosPorAlumno.get(credito.alumnoId).push(credito)
  }
  const filas = planes.map((plan) => {
    const alumno = alumnoPorId.get(plan.alumnoId)
    const lotes = (creditosPorAlumno.get(plan.alumnoId) ?? []).filter((c) => c.planId === plan.id)
    const restantes = lotes.reduce(
      (total, lote) =>
        total + Math.max(0, (lote.minutosComprados ?? 0) - (lote.minutosUsados ?? 0)),
      0,
    )
    const vence = lotes.map((l) => l.venceEn).filter(Boolean).sort()[0] ?? ''
    return {
      alumno: alumno ? `${alumno.nombre ?? ''} ${alumno.apellidos ?? ''}`.trim() : '',
      plan: plan.nombre ?? '',
      frecuencia: plan.frecuencia ?? '',
      incluidos: plan.minutosIncluidos ?? 0,
      restantes,
      vence,
      activo: plan.activo === false ? 'Inactivo' : 'Activo',
    }
  })
  return {
    columnas: [
      { clave: 'alumno', label: 'Alumno' },
      { clave: 'plan', label: 'Plan' },
      { clave: 'frecuencia', label: 'Frecuencia' },
      { clave: 'incluidos', label: 'Min. incluidos', tipo: 'numero' },
      { clave: 'restantes', label: 'Min. restantes', tipo: 'numero' },
      { clave: 'vence', label: 'Vence', tipo: 'fecha' },
      { clave: 'activo', label: 'Estado' },
    ],
    filas,
    totales: { clave: 'restantes', label: 'Min. restantes', valor: filas.reduce((t, f) => t + f.restantes, 0) },
  }
}

/** (7) Alumnos inactivos: sin clases en los últimos N días. */
export function alumnosInactivos({ alumnos = [], clases = [], filtros = {} } = {}) {
  const dias = Number(filtros.dias) > 0 ? Number(filtros.dias) : 30
  const hoy = filtros.ahora ?? hoyISO()
  const corte = sumarDias(hoy, -dias)
  const porAlumno = agruparPor(clases.filter((c) => c.estado !== 'cancelada'), (c) => c.id)
  const ultimaPorAlumno = new Map()
  for (const clase of clases) {
    if (clase.estado === 'cancelada') continue
    for (const alumnoId of clase.alumnos ?? []) {
      const actual = ultimaPorAlumno.get(alumnoId)
      if (!actual || clase.fecha > actual) ultimaPorAlumno.set(alumnoId, clase.fecha)
    }
  }
  void porAlumno
  const filas = alumnos
    .filter((a) => a.activo !== false)
    .filter((a) => {
      const ultima = ultimaPorAlumno.get(a.id)
      return !ultima || ultima < corte
    })
    .map((a) => {
      const ultima = ultimaPorAlumno.get(a.id) ?? ''
      const sinClases = ultima ? diasEntre(ultima, hoy) : null
      return {
        nombre: `${a.nombre ?? ''} ${a.apellidos ?? ''}`.trim(),
        contacto: a.telefono || a.email || '',
        ultima,
        dias: sinClases ?? '',
      }
    })
    .sort((a, b) => String(b.dias).localeCompare(String(a.dias)))
  return {
    columnas: [
      { clave: 'nombre', label: 'Alumno' },
      { clave: 'contacto', label: 'Contacto' },
      { clave: 'ultima', label: 'Última clase', tipo: 'fecha' },
      { clave: 'dias', label: 'Días sin clase', tipo: 'numero' },
    ],
    filas,
    totales: { clave: 'nombre', label: 'Alumnos', valor: filas.length },
  }
}

/** (8) Estado de cuenta de un alumno. */
export function estadoCuenta({ alumno = null, cargos = [], pagos = [] } = {}) {
  const cargosAlumno = cargos.filter((c) => c.alumnoId === alumno?.id)
  const pendientes = cargosAlumno.filter((c) => c.estado === 'pendiente')
  const pagados = cargosAlumno.filter((c) => c.estado === 'pagado')
  const filas = cargosAlumno
    .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
    .map((c) => ({
      fecha: c.fecha,
      concepto: c.concepto ?? '',
      detalle: c.planNombre ?? c.claseId ?? '',
      monto: c.montoCents ?? 0,
      estado: c.estado === 'pagado' ? 'Pagado' : c.estado === 'anulado' ? 'Anulado' : 'Pendiente',
    }))
  void pagados
  void pagos
  return {
    columnas: [
      { clave: 'fecha', label: 'Fecha', tipo: 'fecha' },
      { clave: 'concepto', label: 'Concepto' },
      { clave: 'detalle', label: 'Detalle' },
      { clave: 'monto', label: 'Monto', tipo: 'money' },
      { clave: 'estado', label: 'Estado' },
    ],
    filas,
    totales: { clave: 'monto', label: 'Saldo pendiente', tipo: 'money', valor: sumarCents(pendientes) },
    resumen: [
      { label: 'Pendiente', valor: sumarCents(pendientes) },
      { label: 'Pagado', valor: sumarCents(pagados) },
    ],
  }
}

/** (9) Listado de profesores. */
export function listadoProfesores({ profesores = [], filtros = {} } = {}) {
  const filas = profesores
    .filter((p) => !filtros.soloActivos || p.activo !== false)
    .map((p) => ({
      nombre: `${p.nombre ?? ''} ${p.apellidos ?? ''}`.trim(),
      contacto: p.telefono || p.email || '',
      sedes: (p.sedes ?? []).join(', '),
      estado: p.activo === false ? 'Inactivo' : 'Activo',
    }))
  return {
    columnas: [
      { clave: 'nombre', label: 'Profesor' },
      { clave: 'contacto', label: 'Contacto' },
      { clave: 'sedes', label: 'Sedes' },
      { clave: 'estado', label: 'Estado' },
    ],
    filas,
    totales: { clave: 'nombre', label: 'Profesores', valor: filas.length },
  }
}

/** (10) Horas dictadas y pago por profesor. */
export function horasPagoProfesor({ clases = [], pagos = [], filtros = {} } = {}) {
  const porProfesor = new Map()
  const asegurar = (id, nombre) => {
    if (!porProfesor.has(id)) {
      porProfesor.set(id, { id, profesor: nombre ?? '', minutos: 0, clases: 0, pagado: 0, pendiente: 0 })
    }
    return porProfesor.get(id)
  }
  for (const clase of clases) {
    if (clase.estado === 'cancelada' || clase.estado === 'reservada') continue
    if (!enRango(clase.fecha, filtros.desde, filtros.hasta)) continue
    if (filtros.profesorId && clase.profesorId !== filtros.profesorId) continue
    const fila = asegurar(clase.profesorId, clase.profesorNombre)
    if (fila.profesor === '' && clase.profesorNombre) fila.profesor = clase.profesorNombre
    fila.minutos += duracionMinutos(clase)
    fila.clases += 1
  }
  for (const pago of pagos) {
    if (!enRango(pago.fecha, filtros.desde, filtros.hasta)) continue
    if (filtros.sedeId && pago.sedeId !== filtros.sedeId) continue
    const fila = asegurar(pago.profesorId, pago.profesorNombre)
    if (pago.estado === 'pagado') fila.pagado += pago.montoCents ?? 0
    else if (pago.estado === 'pendiente') fila.pendiente += pago.montoCents ?? 0
  }
  const filas = [...porProfesor.values()]
    .map((f) => ({ ...f, horas: Math.round((f.minutos / 60) * 10) / 10 }))
    .sort((a, b) => a.profesor.localeCompare(b.profesor, 'es'))
  return {
    columnas: [
      { clave: 'profesor', label: 'Profesor' },
      { clave: 'clases', label: 'Clases', tipo: 'numero' },
      { clave: 'horas', label: 'Horas', tipo: 'numero' },
      { clave: 'pagado', label: 'Pagado', tipo: 'money' },
      { clave: 'pendiente', label: 'Pendiente', tipo: 'money' },
    ],
    filas,
    totales: {
      clave: 'pendiente',
      label: 'Total pendiente',
      tipo: 'money',
      valor: filas.reduce((t, f) => t + f.pendiente, 0),
    },
  }
}

/** (11) Cuentas por cobrar con buckets de antigüedad. */
export function cuentasPorCobrar({ cargos = [], filtros = {} } = {}) {
  const hoy = filtros.ahora ?? hoyISO()
  const pendientes = cargos.filter((c) => c.estado === 'pendiente')
  const filas = pendientes
    .map((c) => {
      const edad = c.fecha ? diasEntre(c.fecha, hoy) : 0
      return {
        fecha: c.fecha,
        alumno: c.alumnoNombre ?? '',
        sede: c.sedeId ?? '',
        concepto: c.concepto ?? '',
        monto: c.montoCents ?? 0,
        edad,
        bucket: edad <= 7 ? '0-7' : edad <= 30 ? '8-30' : '>30',
      }
    })
    .sort((a, b) => b.edad - a.edad)
  const buckets = { '0-7': 0, '8-30': 0, '>30': 0 }
  for (const fila of filas) buckets[fila.bucket] += fila.monto
  return {
    columnas: [
      { clave: 'fecha', label: 'Fecha', tipo: 'fecha' },
      { clave: 'alumno', label: 'Alumno' },
      { clave: 'concepto', label: 'Concepto' },
      { clave: 'monto', label: 'Monto', tipo: 'money' },
      { clave: 'edad', label: 'Días', tipo: 'numero' },
      { clave: 'bucket', label: 'Antigüedad' },
    ],
    filas,
    totales: { clave: 'monto', label: 'Total por cobrar', tipo: 'money', valor: sumarCents(pendientes) },
    resumen: [
      { label: '0-7 días', valor: buckets['0-7'], tipo: 'money' },
      { label: '8-30 días', valor: buckets['8-30'], tipo: 'money' },
      { label: 'Más de 30', valor: buckets['>30'], tipo: 'money' },
    ],
  }
}

/** (12) Cobros recibidos por período, por sede y perfil de cobro. */
export function cobrosRecibidos({ cargos = [], clases = [] } = {}, filtros = {}) {
  const clasePorId = new Map(clases.map((c) => [c.id, c]))
  const pagados = cargos.filter((c) => c.estado === 'pagado' && enRango(c.fecha, filtros.desde, filtros.hasta))
  const grupos = new Map()
  for (const cargo of pagados) {
    const clase = cargo.claseId ? clasePorId.get(cargo.claseId) : null
    const perfil = clase?.cobro?.perfilCobroId ?? (cargo.concepto === 'mensualidad' ? 'mensualidad' : 'sin_perfil')
    const clave = `${cargo.sedeId ?? ''}|${perfil}`
    if (!grupos.has(clave)) grupos.set(clave, { sede: cargo.sedeId ?? '', perfil, cantidad: 0, monto: 0 })
    const grupo = grupos.get(clave)
    grupo.cantidad += 1
    grupo.monto += cargo.montoCents ?? 0
  }
  const filas = [...grupos.values()].sort(
    (a, b) => a.sede.localeCompare(b.sede) || a.perfil.localeCompare(b.perfil),
  )
  return {
    columnas: [
      { clave: 'sede', label: 'Sede' },
      { clave: 'perfil', label: 'Perfil de cobro' },
      { clave: 'cantidad', label: 'Cantidad', tipo: 'numero' },
      { clave: 'monto', label: 'Recibido', tipo: 'money' },
    ],
    filas,
    totales: { clave: 'monto', label: 'Total recibido', tipo: 'money', valor: filas.reduce((t, f) => t + f.monto, 0) },
  }
}

/** (13) Pagos a profesores: pendientes y pagados. */
export function pagosProfesores({ pagos = [], filtros = {} } = {}) {
  const filas = pagos
    .filter((p) => enRango(p.fecha, filtros.desde, filtros.hasta))
    .filter((p) => !filtros.profesorId || p.profesorId === filtros.profesorId)
    .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
    .map((p) => ({
      fecha: p.fecha,
      profesor: p.profesorNombre ?? '',
      sede: p.sedeId ?? '',
      clase: p.claseId ?? '',
      monto: p.montoCents ?? 0,
      estado: p.estado === 'pagado' ? 'Pagado' : p.estado === 'anulado' ? 'Anulado' : 'Pendiente',
    }))
  const pendiente = pagos
    .filter((p) => p.estado === 'pendiente' && enRango(p.fecha, filtros.desde, filtros.hasta))
    .reduce((t, p) => t + (p.montoCents ?? 0), 0)
  return {
    columnas: [
      { clave: 'fecha', label: 'Fecha', tipo: 'fecha' },
      { clave: 'profesor', label: 'Profesor' },
      { clave: 'sede', label: 'Sede' },
      { clave: 'clase', label: 'Clase' },
      { clave: 'monto', label: 'Monto', tipo: 'money' },
      { clave: 'estado', label: 'Estado' },
    ],
    filas,
    totales: { clave: 'monto', label: 'Pendiente', tipo: 'money', valor: pendiente },
  }
}

/** (15) Resumen del mes. */
export function resumenMes({ clases = [], cargos = [], pagos = [], filtros = {} } = {}) {
  const enPeriodo = (fecha) => enRango(fecha, filtros.desde, filtros.hasta)
  const clasesPeriodo = clases.filter((c) => enPeriodo(c.fecha))
  const realizadas = clasesPeriodo.filter((c) => CERRADAS.has(c.estado))
  const agendadas = clasesPeriodo.filter((c) => c.estado === ABIERTA)
  const cargosPeriodo = cargos.filter((c) => enPeriodo(c.fecha))
  const ingresos = cargosPeriodo
    .filter((c) => c.estado === 'pagado')
    .reduce((t, c) => t + (c.montoCents ?? 0), 0)
  const porCobrar = cargosPeriodo
    .filter((c) => c.estado === 'pendiente')
    .reduce((t, c) => t + (c.montoCents ?? 0), 0)
  const pagosPeriodo = pagos.filter((p) => enPeriodo(p.fecha))
  const pagadoProfesores = pagosPeriodo
    .filter((p) => p.estado === 'pagado')
    .reduce((t, p) => t + (p.montoCents ?? 0), 0)
  const porPagarProfesores = pagosPeriodo
    .filter((p) => p.estado === 'pendiente')
    .reduce((t, p) => t + (p.montoCents ?? 0), 0)
  const minutos = realizadas.reduce((t, c) => t + duracionMinutos(c), 0)
  const resumen = [
    { label: 'Clases realizadas', valor: realizadas.length, tipo: 'numero' },
    { label: 'Clases agendadas', valor: agendadas.length, tipo: 'numero' },
    { label: 'Horas dictadas', valor: Math.round((minutos / 60) * 10) / 10, tipo: 'numero' },
    { label: 'Ingresos cobrados', valor: ingresos, tipo: 'money' },
    { label: 'Por cobrar', valor: porCobrar, tipo: 'money' },
    { label: 'Pagado a profesores', valor: pagadoProfesores, tipo: 'money' },
    { label: 'Por pagar a profesores', valor: porPagarProfesores, tipo: 'money' },
  ]
  return { columnas: [], filas: [], resumen }
}

/* ------------------------------------------------------------------ */
/* Registro de informes                                                */
/* ------------------------------------------------------------------ */

const FILTROS_MENSUAL = ['rango', 'sede']
const FILTROS_PROFESOR = ['rango', 'sede', 'profesor']

/**
 * Catálogo de los 15 informes. `fuentes` indica qué colecciones carga el
 * orquestador (Reportes.jsx) antes de llamar a `construir`. `grupo` agrupa la
 * lista en la UI; `prioridad` es el orden pedido en la especificación.
 */
export const INFORMES = Object.freeze([
  { id: 'clases-agendadas', titulo: 'Clases agendadas', grupo: 'prioritario', prioridad: 1, filtros: ['rango', 'sede', 'profesor'], fuentes: ['clases', 'sedes'], construir: clasesAgendadas },
  { id: 'clases-realizadas', titulo: 'Clases realizadas', grupo: 'prioritario', prioridad: 2, filtros: ['rango', 'sede', 'profesor'], fuentes: ['clases'], construir: clasesRealizadas },
  { id: 'listado-alumnos', titulo: 'Listado de alumnos', grupo: 'prioritario', prioridad: 3, filtros: ['estado'], fuentes: ['alumnos'], construir: listadoAlumnos },
  { id: 'estado-cuenta', titulo: 'Estado de cuenta del alumno', grupo: 'prioritario', prioridad: 4, filtros: ['alumno'], fuentes: ['alumnos', 'cargos'], construir: estadoCuenta, unAlumno: true },
  { id: 'listado-profesores', titulo: 'Listado de profesores', grupo: 'prioritario', prioridad: 5, filtros: ['estado'], fuentes: ['profesores'], construir: listadoProfesores },
  { id: 'horas-pago-profesor', titulo: 'Horas y pago por profesor', grupo: 'prioritario', prioridad: 6, filtros: FILTROS_PROFESOR, fuentes: ['clases', 'pagos', 'sedes'], construir: horasPagoProfesor },
  { id: 'cuentas-por-cobrar', titulo: 'Cuentas por cobrar', grupo: 'prioritario', prioridad: 7, filtros: ['sede'], fuentes: ['cargos'], construir: cuentasPorCobrar },
  { id: 'cobros-recibidos', titulo: 'Cobros recibidos', grupo: 'prioritario', prioridad: 8, filtros: FILTROS_MENSUAL, fuentes: ['cargos', 'clases', 'sedes'], construir: cobrosRecibidos },
  { id: 'resumen-mes', titulo: 'Resumen del mes', grupo: 'prioritario', prioridad: 9, filtros: FILTROS_MENSUAL, fuentes: ['clases', 'cargos', 'pagos'], construir: resumenMes },
  { id: 'ocupacion-canchas', titulo: 'Ocupación de canchas', grupo: 'secundario', prioridad: 10, filtros: FILTROS_MENSUAL, fuentes: ['clases', 'sedes', 'canchas'], construir: ocupacionCanchas },
  { id: 'agenda-profesor', titulo: 'Agenda semanal por profesor', grupo: 'secundario', prioridad: 11, filtros: FILTROS_PROFESOR, fuentes: ['clases', 'sedes'], construir: agendaSemanalProfesor },
  { id: 'planes-credito', titulo: 'Planes y crédito', grupo: 'secundario', prioridad: 12, filtros: [], fuentes: ['planes', 'creditos', 'alumnos'], construir: planesCredito },
  { id: 'alumnos-inactivos', titulo: 'Alumnos inactivos', grupo: 'secundario', prioridad: 13, filtros: ['dias', 'sede'], fuentes: ['alumnos', 'clases'], construir: alumnosInactivos },
  { id: 'pagos-profesores', titulo: 'Pagos a profesores', grupo: 'secundario', prioridad: 14, filtros: ['rango', 'sede', 'profesor'], fuentes: ['pagos', 'sedes'], construir: pagosProfesores },
  { id: 'faltas-descuentos', titulo: 'Faltas, cortesías y descuentos', grupo: 'secundario', prioridad: 15, filtros: FILTROS_MENSUAL, fuentes: ['clases', 'cargos', 'sedes'], construir: faltasCortesiasDescuentos },
])

/** Busca un informe por id. */
export function informePorId(id) {
  return INFORMES.find((inf) => inf.id === id) ?? null
}

/** Rango por defecto de los informes: el mes en curso. */
export function rangoMesActual(ahora = hoyISO()) {
  const [y, m] = ahora.split('-').map(Number)
  const desde = `${y}-${String(m).padStart(2, '0')}-01`
  const ultimoDia = new Date(y, m, 0).getDate()
  const hasta = `${y}-${String(m).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
  return { desde, hasta }
}

/** Formatea una celda para CSV/texto según el tipo de columna. */
export function formatearCelda(valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return ''
  if (tipo === 'money') return (Number(valor) / 100).toFixed(2)
  if (tipo === 'fecha') return formatearFechaLarga(valor)
  return String(valor)
}

/** Formatea un importe en centavos como texto USD (para WhatsApp). */
export function textoImporte(cents) {
  return formatearUSD(cents)
}
