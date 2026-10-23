/*
 * Seed del "tenant de ensayo" contra el Emulator Suite.
 *
 * No agrega dependencias: usa fetch nativo de Node y la API REST del emulador.
 * Usa el token "owner" del emulador para saltear las Security Rules (es el
 * único lugar del proyecto autorizado a hacerlo, y solo corre local).
 *
 * Los datos salen del constructor puro scripts/seed-data.mjs (el mismo que usa
 * el seed de la demo en la nube); este archivo solo los escribe en el emulador.
 *
 * Requisitos: emuladores de auth + firestore levantados. Ver README.
 * Uso:  npm run seed        (o  node scripts/seed.mjs)
 */

import { construirSeed } from './seed-data.mjs'

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'academia-padel-jdm'
const EMULATOR_HOST = process.env.EMULATOR_HOST ?? '127.0.0.1'
const FIRESTORE_PORT = process.env.FIRESTORE_EMULATOR_PORT ?? '8080'
const AUTH_PORT = process.env.AUTH_EMULATOR_PORT ?? '9099'

const FIRESTORE = `http://${EMULATOR_HOST}:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
const AUTH = `http://${EMULATOR_HOST}:${AUTH_PORT}`
const TENANT = 'ensayo'
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

async function crearUsuario({ uid, email, password, nombre }) {
  const { ok, status, body } = await request(
    `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`,
    {
      method: 'POST',
      headers: { ...OWNER_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid, email, password, emailVerified: true, displayName: nombre }),
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

/*
 * Alumnos extra deterministas: `SEED_ALUMNOS_EXTRA=N` agrega N fichas más para
 * ejercitar el listado paginado (páginas de 100). Ver `alumnoExtra` en seed-data.mjs.
 */
const CANTIDAD_EXTRA = Math.max(0, Number.parseInt(process.env.SEED_ALUMNOS_EXTRA ?? '0', 10) || 0)

async function main() {
  console.log(`Seed del tenant "${TENANT}" en ${EMULATOR_HOST} (proyecto ${PROJECT_ID})…`)

  try {
    await fetch(`${AUTH}/`, { method: 'GET' })
  } catch {
    throw new Error('No responden los emuladores. Levantalos con `npm run emulators` antes de seedear.')
  }

  const seed = construirSeed({ tenantId: TENANT, ahora: new Date(), alumnosExtra: CANTIDAD_EXTRA })

  await limpiar()
  console.log('· Emuladores limpios')

  for (const usuario of seed.usuarios) {
    const uid = await crearUsuario(usuario)
    if (uid !== usuario.uid) throw new Error(`Auth devolvió uid ${uid} para ${usuario.email} (esperado ${usuario.uid})`)
  }
  for (const { path, data } of seed.docs) await setDoc(path, data)

  const { sedes, alumnosBase, alumnosExtra, perfilesCobro } = seed.resumen
  const totalCanchas = sedes.reduce((total, sede) => total + sede.canchas, 0)
  console.log(`· ${sedes.length} sedes (${sedes.map((s) => `${s.nombre} ${s.canchas}`).join(', ')}) y ${totalCanchas} canchas activas`)
  console.log(`· ${perfilesCobro} perfiles de cobro (${perfilesCobro - 1} activos + 1 inactivo) y parámetros (config/parametros)`)
  const extra = alumnosExtra ? ` (${alumnosBase} base + ${alumnosExtra} extra por SEED_ALUMNOS_EXTRA)` : ''
  console.log(`· ${alumnosBase + alumnosExtra} alumnos${extra}`)
  console.log('· Profesores, clases (con sus bloques), cargos, pagos al profesor, planes, créditos y consumo de ejemplo')
  console.log('· 4 clases de demo del cierre (ca, cb, cc, cd)')
  console.log(`· ${seed.usuarios.length} usuarios (membresías de admin/alumno/representante + acceso de profesor)`)
  console.log(`· ${seed.docs.length} documentos bajo ${seed.tenantPath}`)

  console.log('\nListo. Usuarios de ensayo (contraseña "ensayo1234"):')
  for (const usuario of seed.usuarios) {
    const acceso =
      usuario.rol === 'administrador'
        ? 'acceso (agenda)'
        : usuario.rol === 'profesor'
          ? 'acceso (asistencia)'
          : 'sin acceso (ficha)'
    console.log(`  ${usuario.rol.padEnd(14)} ${usuario.email.padEnd(22)} ${acceso}`)
  }
  console.log('\nEl admin opera la agenda; el profesor solo carga la asistencia. Emulator UI: http://127.0.0.1:4000')
}

main().catch((error) => {
  console.error('\nSeed falló:', error.message)
  process.exit(1)
})
