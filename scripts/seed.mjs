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
 * Crea una clase con sus bloques de 30 min, reutilizando el mismo cálculo puro
 * que usa `crearClase` en src/firebase/db.js. El seed escribe por REST con
 * token "owner" (único lugar autorizado a saltear reglas), así que no puede
 * llamar la transacción del SDK; reusa `bloquesDeClase` para que la clase sea
 * dueña de sus bloques igual que en la app.
 */
async function crearClaseEnSeed(datos) {
  const bloques = bloquesDeClase(datos)
  const creadoEn = new Date()
  const cupo = datos.cupo ?? 4
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

const SEDES = [
  { id: 'traki', nombre: 'Traki', canchas: 3 },
  { id: 'boleita', nombre: 'Boleíta', canchas: 2 },
  { id: 'santa-rosa', nombre: 'Santa Rosa', canchas: 2 },
  { id: 'capital', nombre: 'Capital', canchas: 2 },
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
 * Fichas de alumno de ensayo: un adulto, un menor con representante y una
 * inactiva (que el seed NUNCA asigna: `resolverAsignacion` la rechaza). Los
 * datos de contacto son solo del administrador (ver firestore.rules), y los
 * teléfonos/documentos son claramente falsos.
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
]

const ALUMNOS_POR_ID = Object.fromEntries(ALUMNOS.map((alumno) => [alumno.id, alumno]))

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
    })
    for (let i = 1; i <= sede.canchas; i += 1) {
      await setDoc(`${tenant}/sedes/${sede.id}/canchas/c${i}`, {
        nombre: `Cancha ${i}`,
        numero: i,
        tipo: i % 2 === 0 ? 'outdoor' : 'indoor',
        activa: true,
      })
    }
  }
  console.log(`· ${SEDES.length} sedes y sus canchas`)

  // La tarifa por hora queda SIN DEFINIR: no se escribe ningún campo de tarifa.
  for (const profesor of PROFESORES) {
    const { id, ...ficha } = profesor
    await setDoc(`${tenant}/profesores/${id}`, ficha)
  }

  for (const alumno of ALUMNOS) {
    const { id, ...ficha } = alumno
    await setDoc(`${tenant}/alumnos/${id}`, {
      ...ficha,
      ...camposBusqueda(ficha),
    })
  }

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
