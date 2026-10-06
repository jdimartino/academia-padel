/*
 * Seed del "tenant de ensayo" contra el Emulator Suite.
 *
 * No agrega dependencias: usa fetch nativo de Node y la API REST del emulador.
 * Usa el token "owner" del emulador para saltear las Security Rules (es el
 * único lugar del proyecto autorizado a hacerlo, y solo corre local).
 *
 * Requisitos: emuladores de auth + firestore levantados. Ver README.
 * Uso:  npm run seed        (o  node scripts/seed.mjs)
 */

import { bloquesDeClase, camposBusqueda, nombreCompleto, resolverAsignacion } from '../src/firebase/db.js'

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'academia-padel-jdm'
const EMULATOR_HOST = process.env.EMULATOR_HOST ?? '127.0.0.1'
const FIRESTORE_PORT = process.env.FIRESTORE_EMULATOR_PORT ?? '8080'
const AUTH_PORT = process.env.AUTH_EMULATOR_PORT ?? '9099'

const FIRESTORE = `http://${EMULATOR_HOST}:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
const AUTH = `http://${EMULATOR_HOST}:${AUTH_PORT}`
const TENANT = 'ensayo'
const TENANT_DOC = `academias/${TENANT}`
const OWNER_HEADERS = { Authorization: 'Bearer owner' }

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } }
  if (typeof value === 'object') return { mapValue: { fields: toFields(value) } }
  throw new Error(`Tipo no soportado en seed: ${typeof value}`)
}

function toFields(data) {
  const fields = {}
  for (const [key, value] of Object.entries(data)) fields[key] = toValue(value)
  return fields
}

async function request(url, options = {}) {
  const res = await fetch(url, options)
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { ok: res.ok, status: res.status, body }
}

async function setDoc(path, data) {
  const { ok, status, body } = await request(`${FIRESTORE}/${path}`, {
    method: 'PATCH',
    headers: { ...OWNER_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) }),
  })
  if (!ok) throw new Error(`Firestore PATCH ${path} → ${status}: ${JSON.stringify(body)}`)
}

async function crearUsuario({ email, password, nombre }) {
  const { ok, status, body } = await request(
    `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`,
    {
      method: 'POST',
      headers: { ...OWNER_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, emailVerified: true, displayName: nombre }),
    },
  )
  if (!ok) throw new Error(`Auth crear ${email} → ${status}: ${JSON.stringify(body)}`)
  return body.localId
}

async function limpiar() {
  await request(`${AUTH}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE',
    headers: OWNER_HEADERS,
  })
  await request(`${FIRESTORE}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: 'DELETE',
    headers: OWNER_HEADERS,
  })
}

/** "YYYY-MM-DD" relativo a hoy, con partes LOCALES (no toISOString: Caracas es UTC-4). */
function diaRelativo(dias) {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Crea una clase con sus bloques de 60 min (uno por hora en punto),
 * reutilizando el mismo cálculo puro que usa `crearClase` en src/firebase/db.js.
 * El seed escribe por REST con token "owner" (único lugar autorizado a saltear
 * reglas), así que no puede llamar la transacción del SDK; reusa
 * `bloquesDeClase` para que la clase sea dueña de sus bloques igual que en la
 * app. Horario: arranque en punto, duración 1 h o 2 h, fin máximo 23:00.
 */
async function crearClaseEnSeed(datos) {
  const bloques = bloquesDeClase(datos)
  const creadoEn = new Date()
  const cupo = datos.cupo ?? 4
  // Ninguna clase del seed se siembra sin alumnos (misma regla que la app).
  if (!(datos.alumnosIds ?? []).length) {
    throw new Error(`La clase ${datos.id} del seed necesita al menos un alumno`)
  }
  // Mismo camino de validación/denormalización que `asignarAlumnos` en la app:
  // el seed no puede correr la transacción (escribe por REST con token owner),
  // pero reusa `resolverAsignacion` con las fichas que acaba de escribir.
  const { alumnos, alumnoNombres } = resolverAsignacion(
    datos.alumnosIds ?? [],
    ALUMNOS_POR_ID,
    cupo,
  )
  const clase = {
    tipo: 'variable',
    serieId: null,
    estado: datos.estado ?? 'reservada',
    categoria: datos.categoria ?? null,
    asistencias: datos.asistencias ?? [],
    alumnos,
    alumnoNombres,
    cupo,
    sedeId: datos.sedeId,
    sedeNombre: datos.sedeNombre ?? null,
    canchaId: datos.canchaId,
    profesorId: datos.profesorId,
    profesorNombre: datos.profesorNombre ?? null,
    fecha: datos.fecha,
    horaInicio: datos.horaInicio,
    horaFin: datos.horaFin,
    bloques: bloques.map((b) => b.id),
    creadoPor: 'seed',
    creadoEn,
  }
  await setDoc(`${TENANT_DOC}/clases/${datos.id}`, clase)
  for (const bloque of bloques) {
    await setDoc(`${TENANT_DOC}/bloques/${bloque.id}`, {
      ...bloque.data,
      claseId: datos.id,
      creadoPor: 'seed',
      creadoEn,
    })
  }
}

/*
 * Usuarios de Auth del tenant de ensayo. Por ahora SOLO el administrador tiene
 * acceso. profe@, alumno@ y representante@ se conservan como usuarios
 * NEGATIVOS: tienen membresía con su rol, pero las reglas les niegan toda
 * lectura/escritura salvo su propia membresía. Profesor y alumno son fichas
 * (records), no cuentas: ya no se enlazan con `profesorId`/`alumnoId` en la
 * membresía.
 */
const USUARIOS = [
  { email: 'admin@ensayo.test', password: 'ensayo1234', nombre: 'Ana Administradora', rol: 'administrador' },
  { email: 'profe@ensayo.test', password: 'ensayo1234', nombre: 'Pablo Profesor', rol: 'profesor' },
  { email: 'alumno@ensayo.test', password: 'ensayo1234', nombre: 'Aldo Adulto', rol: 'alumno_adulto' },
  { email: 'representante@ensayo.test', password: 'ensayo1234', nombre: 'Teresa Representante', rol: 'alumno_menor' },
]

/*
 * Sedes del tenant de ensayo: 4 canchas ACTIVAS cada una y horario 07:00-23:00
 * (el mismo default de la capa de datos). Las canchas se numeran c1..c4.
 */
const CANCHAS_POR_SEDE = 4
const HORARIO_SEDE = { apertura: 7, cierre: 23 }

const SEDES = [
  { id: 'traki', nombre: 'Traki' },
  { id: 'boleita', nombre: 'Boleíta' },
  { id: 'santa-rosa', nombre: 'Santa Rosa' },
  { id: 'capital', nombre: 'Capital' },
]

/*
 * Fichas de profesor de ensayo. `sedes` son las sedes donde dicta: p1 cubre las
 * sedes que usan las clases sembradas (traki) y p2 NO está en traki, para poder
 * ejercitar el rechazo "profesor no asignado a la sede".
 * La tarifa por hora queda SIN DEFINIR: no se escribe ningún campo de tarifa.
 */
const PROFESORES = [
  {
    id: 'p1',
    nombre: 'Pablo',
    apellidos: 'Profesor',
    email: 'profe@ensayo.test',
    telefono: '+58 000 000 0011',
    documento: { tipo: 'cedula', numero: 'V-00000011' },
    sedes: ['traki', 'boleita'],
    notas: '',
    activo: true,
  },
  {
    id: 'p2',
    nombre: 'Paola',
    apellidos: 'Profesora',
    email: 'paola@ensayo.test',
    telefono: '+58 000 000 0012',
    documento: { tipo: 'pasaporte', numero: 'P-00000012' },
    sedes: ['santa-rosa', 'capital'],
    notas: '',
    activo: true,
  },
]

const PROFESORES_POR_ID = Object.fromEntries(PROFESORES.map((p) => [p.id, p]))

/*
 * Fichas de alumno de ensayo. La base son tres (un adulto, un menor con
 * representante y una inactiva que el seed NUNCA asigna: `resolverAsignacion`
 * la rechaza) más una docena de fichas variadas: apellidos con tildes y con
 * ñ, adultos y menores (los menores siempre con representante) y al menos dos
 * inactivas. Los datos de contacto son solo del administrador (ver
 * firestore.rules), y los teléfonos/documentos son claramente falsos.
 */
const ALUMNOS = [
  {
    id: 'a1',
    tipo: 'adulto',
    nombre: 'Aldo',
    apellidos: 'Adulto',
    nivel: '4a',
    email: 'alumno@ensayo.test',
    telefono: '+58 000 000 0001',
    documento: { tipo: 'cedula', numero: 'V-00000001' },
    contactoEmergencia: { nombre: 'Elsa Emergencia', telefono: '+58 000 000 0009' },
    representante: null,
    fechaIngreso: diaRelativo(-120),
    avisosActivos: true,
    activo: true,
    notas: '',
  },
  {
    id: 'a2',
    tipo: 'menor',
    nombre: 'Marta',
    apellidos: 'Menor',
    nivel: 'principiante',
    email: null,
    telefono: null,
    documento: null,
    contactoEmergencia: null,
    representante: {
      nombre: 'Teresa',
      apellidos: 'Representante',
      email: 'representante@ensayo.test',
      telefono: '+58 000 000 0003',
    },
    fechaIngreso: diaRelativo(-60),
    avisosActivos: true,
    activo: true,
    notas: '',
  },
  {
    id: 'a3',
    tipo: 'adulto',
    nombre: 'Nadia',
    apellidos: 'Inactiva',
    nivel: null,
    email: null,
    telefono: null,
    documento: null,
    contactoEmergencia: null,
    representante: null,
    fechaIngreso: diaRelativo(-200),
    avisosActivos: false,
    activo: false,
    notas: 'Ficha de ensayo inactiva (no se asigna)',
  },
  // Doce fichas variadas: apellidos con tildes y con ñ, adultos y menores (los
  // menores con representante) y dos inactivas más (a9 y a13).
  {
    id: 'a4',
    tipo: 'adulto',
    nombre: 'Ángel',
    apellidos: 'Ávila',
    nivel: '7a',
    email: 'a4@ensayo.test',
    telefono: '+58 000 000 0004',
    documento: { tipo: 'cedula', numero: 'V-00000004' },
    contactoEmergencia: { nombre: 'Ana Ávila', telefono: '+58 000 000 0104' },
    representante: null,
    fechaIngreso: diaRelativo(-150),
    avisosActivos: true,
    activo: true,
    notas: '',
  },
  {
    id: 'a5',
    tipo: 'menor',
    nombre: 'Iker',
    apellidos: 'Ñáñez',
    nivel: 'principiante',
    email: null,
    telefono: null,
    documento: null,
    contactoEmergencia: null,
    representante: {
      nombre: 'Nora',
      apellidos: 'Ñáñez',
      email: 'nora.nanez@ensayo.test',
      telefono: '+58 000 000 0005',
    },
    fechaIngreso: diaRelativo(-45),
    avisosActivos: true,
    activo: true,
    notas: '',
  },
  {
    id: 'a6',
    tipo: 'adulto',
    nombre: 'Lucía',
    apellidos: 'Muñoz',
    nivel: '3a',
    email: null,
    telefono: '+58 000 000 0006',
    documento: null,
    contactoEmergencia: null,
    representante: null,
    fechaIngreso: diaRelativo(-90),
    avisosActivos: false,
    activo: true,
    notas: '',
  },
  {
    id: 'a7',
    tipo: 'menor',
    nombre: 'Diego',
    apellidos: 'Peña',
    nivel: '5a',
    email: null,
    telefono: null,
    documento: null,
    contactoEmergencia: null,
    representante: {
      nombre: 'Raúl',
      apellidos: 'Peña',
      email: 'raul.pena@ensayo.test',
      telefono: '+58 000 000 0007',
    },
    fechaIngreso: diaRelativo(-30),
    avisosActivos: true,
    activo: true,
    notas: '',
  },
  {
    id: 'a8',
    tipo: 'adulto',
    nombre: 'Sofía',
    apellidos: 'Vásquez',
    nivel: '2a',
    email: 'sofia.vasquez@ensayo.test',
    telefono: '+58 000 000 0008',
    documento: { tipo: 'pasaporte', numero: 'P-00000008' },
    contactoEmergencia: null,
    representante: null,
    fechaIngreso: diaRelativo(-210),
    avisosActivos: true,
    activo: true,
    notas: '',
  },
  {
    id: 'a9',
    tipo: 'adulto',
    nombre: 'Tomás',
    apellidos: 'González',
    nivel: null,
    email: null,
    telefono: '+58 000 000 0009',
    documento: null,
    contactoEmergencia: null,
    representante: null,
    fechaIngreso: diaRelativo(-400),
    avisosActivos: false,
    activo: false,
    notas: 'Ficha de ensayo inactiva (no se asigna)',
  },
  {
    id: 'a10',
    tipo: 'menor',
    nombre: 'Camila',
    apellidos: 'Ríos',
    nivel: '6a',
    email: null,
    telefono: null,
    documento: null,
    contactoEmergencia: null,
    representante: {
      nombre: 'Valeria',
      apellidos: 'Ríos',
      email: 'valeria.rios@ensayo.test',
      telefono: '+58 000 000 0010',
    },
    fechaIngreso: diaRelativo(-75),
    avisosActivos: true,
    activo: true,
    notas: '',
  },
  {
    id: 'a11',
    tipo: 'adulto',
    nombre: 'Joaquín',
    apellidos: 'Iriarte',
    nivel: '4a',
    email: null,
    telefono: '+58 000 000 0011',
    documento: null,
    contactoEmergencia: null,
    representante: null,
    fechaIngreso: diaRelativo(-20),
    avisosActivos: true,
    activo: true,
    notas: '',
  },
  {
    id: 'a12',
    tipo: 'menor',
    nombre: 'Renata',
    apellidos: 'Cañas',
    nivel: '1a',
    email: null,
    telefono: null,
    documento: null,
    contactoEmergencia: null,
    representante: {
      nombre: 'Marta',
      apellidos: 'Cañas',
      email: 'marta.canas@ensayo.test',
      telefono: '+58 000 000 0012',
    },
    fechaIngreso: diaRelativo(-55),
    avisosActivos: true,
    activo: true,
    notas: '',
  },
  {
    id: 'a13',
    tipo: 'menor',
    nombre: 'Bruno',
    apellidos: 'Iturbe',
    nivel: 'principiante',
    email: null,
    telefono: null,
    documento: null,
    contactoEmergencia: null,
    representante: {
      nombre: 'Paola',
      apellidos: 'Iturbe',
      email: null,
      telefono: '+58 000 000 0013',
    },
    fechaIngreso: diaRelativo(-330),
    avisosActivos: false,
    activo: false,
    notas: 'Ficha de ensayo inactiva (no se asigna)',
  },
  {
    id: 'a14',
    tipo: 'adulto',
    nombre: 'Elena',
    apellidos: 'Zambrano',
    nivel: '7a',
    email: null,
    telefono: '+58 000 000 0014',
    documento: null,
    contactoEmergencia: null,
    representante: null,
    fechaIngreso: diaRelativo(-10),
    avisosActivos: true,
    activo: true,
    notas: '',
  },
  {
    id: 'a15',
    tipo: 'adulto',
    nombre: 'Óscar',
    apellidos: 'Núñez',
    nivel: null,
    email: 'oscar.nunez@ensayo.test',
    telefono: '+58 000 000 0015',
    documento: null,
    contactoEmergencia: null,
    representante: null,
    fechaIngreso: diaRelativo(-180),
    avisosActivos: false,
    activo: true,
    notas: '',
  },
]

const ALUMNOS_POR_ID = Object.fromEntries(ALUMNOS.map((alumno) => [alumno.id, alumno]))

/*
 * Alumnos extra deterministas: `SEED_ALUMNOS_EXTRA=N` agrega N fichas más para
 * ejercitar el listado paginado (páginas de 100). Son ficticios y repetitivos
 * A PROPÓSITO: mismos datos en cada corrida, sin `Math.random()`, para que el
 * ensayo sea reproducible. Se reparten ~1 de cada 7 inactivos y ~1 de cada 3
 * menores (con representante).
 */
const NOMBRES_EXTRA = [
  'Ana', 'Beto', 'Carmen', 'Diego', 'Elena', 'Fabio', 'Gabriela', 'Hernán',
  'Irene', 'Jorge', 'Karina', 'Luis', 'María', 'Néstor', 'Olga', 'Pedro',
  'Quirino', 'Rosa', 'Simón', 'Teresa', 'Úrsula', 'Víctor', 'Wanda', 'Xiomara',
]

const APELLIDOS_EXTRA = [
  'Ávila', 'Blanco', 'Cañas', 'Delgado', 'Espinoza', 'Farías', 'González', 'Hernández',
  'Ibarra', 'Jiménez', 'López', 'Muñoz', 'Núñez', 'Ñáñez', 'Ochoa', 'Peña',
  'Quintero', 'Rodríguez', 'Sánchez', 'Torres', 'Urbina', 'Vásquez', 'Yáñez', 'Zambrano',
].sort((a, b) => a.localeCompare(b, 'es'))

const NIVELES_EXTRA = ['principiante', '7a', '5a', '3a', '1a']

function alumnoExtra(indice) {
  const n = NOMBRES_EXTRA[indice % NOMBRES_EXTRA.length]
  const a = APELLIDOS_EXTRA[indice % APELLIDOS_EXTRA.length]
  const numero = String(indice + 1).padStart(4, '0')
  const menor = indice % 3 === 1
  return {
    id: `extra-${numero}`,
    tipo: menor ? 'menor' : 'adulto',
    nombre: n,
    apellidos: a,
    nivel: indice % 4 === 3 ? null : NIVELES_EXTRA[indice % NIVELES_EXTRA.length],
    email: null,
    telefono: menor ? null : `+58 000 000 ${numero}`,
    documento: null,
    contactoEmergencia: null,
    representante: menor
      ? {
          nombre: 'Rep',
          apellidos: `Extra ${numero}`,
          email: null,
          telefono: `+58 000 001 ${numero}`,
        }
      : null,
    fechaIngreso: diaRelativo(-((indice % 300) + 1)),
    avisosActivos: indice % 2 === 0,
    activo: indice % 7 !== 5,
    notas: '',
  }
}

const CANTIDAD_EXTRA = Math.max(0, Number.parseInt(process.env.SEED_ALUMNOS_EXTRA ?? '0', 10) || 0)

const ALUMNOS_EXTRA = Array.from({ length: CANTIDAD_EXTRA }, (_, i) => alumnoExtra(i))

/** Todas las fichas de alumno que escribe el seed (base + extra). */
const ALUMNOS_SEED = [...ALUMNOS, ...ALUMNOS_EXTRA]

async function main() {
  console.log(`Seed del tenant "${TENANT}" en ${EMULATOR_HOST} (proyecto ${PROJECT_ID})…`)

  try {
    await fetch(`${AUTH}/`, { method: 'GET' })
  } catch {
    throw new Error('No responden los emuladores. Levantalos con `npm run emulators` antes de seedear.')
  }

  await limpiar()
  console.log('· Emuladores limpios')

  const tenant = 'academias/' + TENANT
  await setDoc(tenant, {
    nombre: 'Academia de Ensayo',
    slug: TENANT,
    estado: 'activa',
    plan: 'basico',
    zonaHoraria: 'America/Caracas',
    moneda: 'USD',
    creadoEn: new Date(),
  })

  for (const sede of SEDES) {
    await setDoc(`${tenant}/sedes/${sede.id}`, {
      nombre: sede.nombre,
      direccion: `Sede ${sede.nombre}`,
      activa: true,
      orden: SEDES.indexOf(sede),
      horario: HORARIO_SEDE,
    })
    for (let i = 1; i <= CANCHAS_POR_SEDE; i += 1) {
      await setDoc(`${tenant}/sedes/${sede.id}/canchas/c${i}`, {
        nombre: `Cancha ${i}`,
        numero: i,
        tipo: i % 2 === 0 ? 'outdoor' : 'indoor',
        activa: true,
      })
    }
  }
  console.log(`· ${SEDES.length} sedes y ${CANCHAS_POR_SEDE} canchas activas cada una`)

  // La tarifa por hora queda SIN DEFINIR: no se escribe ningún campo de tarifa.
  for (const profesor of PROFESORES) {
    const { id, ...ficha } = profesor
    await setDoc(`${tenant}/profesores/${id}`, ficha)
  }

  for (const alumno of ALUMNOS_SEED) {
    const { id, ...ficha } = alumno
    await setDoc(`${tenant}/alumnos/${id}`, {
      ...ficha,
      ...camposBusqueda(ficha),
    })
  }
  const extra = ALUMNOS_EXTRA.length
    ? ` (${ALUMNOS.length} base + ${ALUMNOS_EXTRA.length} extra por SEED_ALUMNOS_EXTRA)`
    : ''
  console.log(`· ${ALUMNOS_SEED.length} alumnos${extra}`)

  /*
   * Fixture de la regla "no se reserva en el pasado": una clase reservada de
   * ayer. Sirve para ejercitar el rechazo sin fabricar fechas a mano en los
   * tests de la app. Todas las clases del seed arrancan en hora en punto y
   * duran 1 h o 2 h, con al menos un alumno.
   */
  await crearClaseEnSeed({
    id: 'c0',
    sedeId: 'traki',
    sedeNombre: 'Traki',
    canchaId: 'c2',
    profesorId: 'p1',
    profesorNombre: nombreCompleto(PROFESORES_POR_ID.p1),
    fecha: diaRelativo(-1),
    horaInicio: '09:00',
    horaFin: '10:00',
    cupo: 4,
    categoria: '4a',
    alumnosIds: ['a1'],
    estado: 'reservada',
  })

  await crearClaseEnSeed({
    id: 'c1',
    sedeId: 'traki',
    sedeNombre: 'Traki',
    canchaId: 'c1',
    profesorId: 'p1',
    profesorNombre: nombreCompleto(PROFESORES_POR_ID.p1),
    fecha: diaRelativo(1),
    horaInicio: '18:00',
    horaFin: '19:00',
    cupo: 4,
    categoria: '6a',
    alumnosIds: ['a1'],
    estado: 'reservada',
  })

  // Antes era "fija" (serieId): las series recurrentes están fuera de alcance,
  // así que pasa a ser una clase "variable" más, creada con sus bloques.
  await crearClaseEnSeed({
    id: 'c2',
    sedeId: 'traki',
    sedeNombre: 'Traki',
    canchaId: 'c1',
    profesorId: 'p1',
    profesorNombre: nombreCompleto(PROFESORES_POR_ID.p1),
    fecha: diaRelativo(-1),
    horaInicio: '18:00',
    horaFin: '19:00',
    cupo: 4,
    categoria: '7a',
    alumnosIds: ['a1', 'a2'],
    asistencias: [
      { alumnoId: 'a1', estado: 'presente', motivo: null, registradoPor: 'seed', registradoEn: new Date() },
      { alumnoId: 'a2', estado: 'ausente_sin_aviso', motivo: 'enfermedad', registradoPor: 'seed', registradoEn: new Date() },
    ],
    estado: 'pendiente_cobro',
  })

  const periodo = diaRelativo(0).slice(0, 7)
  await setDoc(`${tenant}/cargos/cg1`, {
    alumnoId: 'a1',
    alumnoNombre: 'Aldo Adulto',
    concepto: 'clase',
    claseId: 'c2',
    planId: null,
    periodo,
    montoCentavos: 1500,
    moneda: 'USD',
    estado: 'pendiente',
    anuladoPor: null,
    creadoEn: new Date(),
  })
  await setDoc(`${tenant}/pagos/pg1`, {
    alumnoId: 'a1',
    cargoIds: ['cg1'],
    montoCentavos: 1500,
    metodo: 'transferencia',
    referencia: 'REF-0001',
    comprobante: null,
    estado: 'en_revision',
    motivoRechazo: null,
    revisadoPor: null,
    creadoEn: new Date(),
    revisadoEn: null,
  })
  console.log('· Profesores, alumnos, clases, cargos y pagos')

  const ids = {}
  for (const usuario of USUARIOS) {
    const uid = await crearUsuario(usuario)
    ids[usuario.email] = uid
    await setDoc(`${tenant}/miembros/${uid}`, {
      uid,
      rol: usuario.rol,
      activo: true,
      nombre: usuario.nombre,
      creadoEn: new Date(),
    })
  }
  console.log(`· ${USUARIOS.length} usuarios y membresías`)

  console.log('\nListo. Usuarios de ensayo (contraseña "ensayo1234"):')
  for (const usuario of USUARIOS) {
    const acceso = usuario.rol === 'administrador' ? 'acceso' : 'sin acceso (ficha)'
    console.log(`  ${usuario.rol.padEnd(14)} ${usuario.email.padEnd(22)} ${acceso}`)
  }
  console.log('\nSolo el administrador opera la agenda. Emulator UI: http://127.0.0.1:4000')
}

main().catch((error) => {
  console.error('\nSeed falló:', error.message)
  process.exit(1)
})
