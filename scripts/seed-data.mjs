/*
 * Constructor PURO del dataset de seed de un tenant (sin red ni escrituras).
 *
 * `construirSeed({ tenantId, ahora })` devuelve TODOS los documentos del tenant
 * (`{ path, data }`, siempre bajo `academias/<tenantId>/`) y los usuarios de Auth
 * a crear (con uid fijo, email, contraseña, nombre y rol). Lo consumen:
 *  - scripts/seed.mjs: escritor contra el Emulator Suite (tenant "ensayo").
 *  - jdm/scripts/academia-seed-demo.js: escritor contra la nube (tenant "demo").
 *
 * El reloj se inyecta (`ahora`): las fechas relativas y los `creadoEn` salen de
 * ahí, así que el mismo reloj produce el mismo dataset.
 */

import { bloquesDeClase, camposBusqueda, nombreCompleto, resolverAsignacion } from '../packages/academia-core/src/firebase/db.js'
import { horarioDelDia } from '../packages/academia-core/src/lib/agenda.js'
import { PARAMETROS_DEFAULT, PERFILES_COBRO_DEFAULT } from '../packages/academia-core/src/lib/cobros.js'
import { PLAN_POR_ID, fechaRelativa, planificarClases } from './seed-plan.mjs'

/*
 * Perfil de cada tenant sembrable: nombre de la academia, dominio (ficticio) de
 * los emails y usuarios de Auth. Los uids son fijos (`<tenant>-<rol>`) para que
 * un re-seed o un `--reset` sepan exactamente qué cuentas son del seed.
 *
 * "ensayo" (emulador): el administrador tiene acceso vía `miembros` (rol
 * administrador). El profesor es distinto (Fase 7): NO tiene membresía; su
 * acceso vive SOLO en `usuarios/{uid}` (con el `profesorId` de su ficha) y lo
 * descubre al iniciar sesión con una consulta de grupo por `uid`. alumno@ y
 * representante@ se conservan como usuarios NEGATIVOS: tienen membresía con su
 * rol, pero las reglas les niegan toda lectura/escritura salvo su propia
 * membresía. Alumno y representante son fichas (records), no cuentas: no se
 * enlazan con `alumnoId` en la membresía.
 *
 * "demo" (nube, vitrina pública): solo un administrador y un profesor. Sus
 * credenciales son públicas a propósito (dominio no real).
 */
const PERFILES_TENANT = {
  ensayo: {
    nombre: 'Academia de Ensayo',
    dominio: 'ensayo.test',
    password: 'ensayo1234',
    usuarios: [
      { clave: 'admin', email: 'admin', nombre: 'Ana Administradora', rol: 'administrador' },
      { clave: 'profe', email: 'profe', nombre: 'Pablo Profesor', rol: 'profesor' },
      { clave: 'alumno', email: 'alumno', nombre: 'Aldo Adulto', rol: 'alumno_adulto' },
      { clave: 'representante', email: 'representante', nombre: 'Teresa Representante', rol: 'alumno_menor' },
    ],
  },
  demo: {
    nombre: 'Academia Demo',
    dominio: 'demo.academia-padel.app',
    password: 'demo1234',
    usuarios: [
      { clave: 'admin', email: 'admin', nombre: 'Admin Demo', rol: 'administrador' },
      { clave: 'profe', email: 'profe', nombre: 'Pablo Profesor', rol: 'profesor' },
    ],
  },
}

export const TENANTS_SEED = Object.keys(PERFILES_TENANT)

/*
 * Sedes del tenant de ensayo, con su horario POR DÍA DE LA SEMANA en MINUTOS
 * (0 = lunes … 6 = domingo) y `null` = cerrado, y la cantidad de canchas que
 * tiene cada una (Traki 5, UNE 2, Santa Rosa 4 y Capital 4). Las canchas se
 * numeran c1..cN.
 *
 * Traki es la sede que ilustra las medias horas: abre 7:30 y cierra 15:30 de
 * lunes a viernes, el sábado 8:00-13:00 y el domingo está CERRADA. Sus clases de
 * ejemplo caen siempre dentro de ese horario (ver `planificarClases` en scripts/seed-plan.mjs).
 * UNE usa el default 07:00-23:00 todos los días; Santa Rosa y Capital muestran
 * otros horarios, con Capital cerrada los domingos.
 */

/** Shorthand: franja en horas locales del negocio → minutos desde medianoche. */
const franja = (apertura, cierre) => ({
  apertura: Math.round(apertura * 60),
  cierre: Math.round(cierre * 60),
})

const SEDES = [
  {
    id: 'traki',
    nombre: 'Traki',
    canchas: 5,
    // Tarifa por hora en CENTAVOS de USD, por perfil. Traki tiene todas.
    tarifas: {
      individual: 4500,
      pareja: 5000,
      tres: 6000,
      cuatro: 7000,
      corporativo: 7500,
      especial: 8000,
    },
    horario: {
      0: franja(7.5, 15.5),
      1: franja(7.5, 15.5),
      2: franja(7.5, 15.5),
      3: franja(7.5, 15.5),
      4: franja(7.5, 15.5),
      5: franja(8, 13),
      6: null,
    },
  },
  {
    id: 'une',
    nombre: 'UNE',
    canchas: 2,
    tarifas: { individual: 4500, pareja: 5000, tres: 6000, cuatro: 7000 },
    horario: {
      0: franja(7, 23),
      1: franja(7, 23),
      2: franja(7, 23),
      3: franja(7, 23),
      4: franja(7, 23),
      5: franja(7, 23),
      6: franja(7, 23),
    },
  },
  {
    id: 'santa-rosa',
    nombre: 'Santa Rosa',
    canchas: 4,
    // Sede SIN tarifa de corporativo ni especial: ejercita "sin tarifa".
    tarifas: { individual: 5000, pareja: 5500, tres: 6000, cuatro: 6500 },
    horario: {
      0: franja(9, 21),
      1: franja(9, 21),
      2: franja(9, 21),
      3: franja(9, 21),
      4: franja(9, 21),
      5: franja(9, 14),
      6: franja(9, 14),
    },
  },
  {
    id: 'capital',
    nombre: 'Capital',
    canchas: 4,
    // Sede con MUY pocas tarifas: casi todo se carga a mano.
    tarifas: { individual: 5500, cuatro: 7000 },
    horario: {
      0: franja(8, 22),
      1: franja(8, 22),
      2: franja(8, 22),
      3: franja(8, 22),
      4: franja(8, 22),
      5: franja(8, 22),
      6: null,
    },
  },
]

/*
 * Fichas de profesor de ensayo. `sedes` son las sedes donde dicta: p1 cubre las
 * sedes que usan las clases sembradas (traki) y p2 NO está en traki, para poder
 * ejercitar el rechazo "profesor no asignado a la sede".
 * La tarifa por hora queda SIN DEFINIR: no se escribe ningún campo de tarifa.
 */
const profesoresDe = (dominio) => [
  {
    id: 'p1',
    nombre: 'Pablo',
    apellidos: 'Profesor',
    email: `profe@${dominio}`,
    telefono: '+58 000 000 0011',
    documento: { tipo: 'cedula', numero: 'V-00000011' },
    sedes: ['traki', 'une'],
    notas: '',
    activo: true,
  },
  {
    id: 'p2',
    nombre: 'Paola',
    apellidos: 'Profesora',
    email: `paola@${dominio}`,
    telefono: '+58 000 000 0012',
    documento: { tipo: 'pasaporte', numero: 'P-00000012' },
    sedes: ['santa-rosa', 'capital'],
    notas: '',
    activo: true,
  },
]

/*
 * Fichas de alumno de ensayo. La base son tres (un adulto, un menor con
 * representante y una inactiva que el seed NUNCA asigna: `resolverAsignacion`
 * la rechaza) más una docena de fichas variadas: apellidos con tildes y con
 * ñ, adultos y menores (los menores siempre con representante) y al menos dos
 * inactivas. Los datos de contacto son solo del administrador (ver
 * firestore.rules), y los teléfonos/documentos son claramente falsos.
 */
const alumnosBase = (dominio, diaRelativo) => [
  {
    id: 'a1',
    tipo: 'adulto',
    nombre: 'Aldo',
    apellidos: 'Adulto',
    nivel: '4a',
    email: `alumno@${dominio}`,
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
      email: `representante@${dominio}`,
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
    email: `a4@${dominio}`,
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
      email: `nora.nanez@${dominio}`,
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
      email: `raul.pena@${dominio}`,
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
    email: `sofia.vasquez@${dominio}`,
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
      email: `valeria.rios@${dominio}`,
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
      email: `marta.canas@${dominio}`,
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
    email: `oscar.nunez@${dominio}`,
    telefono: '+58 000 000 0015',
    documento: null,
    contactoEmergencia: null,
    representante: null,
    fechaIngreso: diaRelativo(-180),
    avisosActivos: false,
    activo: true,
    notas: '',
  },
  // Par de hermanos (menores) con el MISMO representante: ejercita el descuento
  // de hermanos y la sugerencia en la ficha (Phase 5).
  {
    id: 'a16',
    tipo: 'menor',
    nombre: 'Mateo',
    apellidos: 'Hermanos',
    nivel: 'principiante',
    email: null,
    telefono: null,
    documento: null,
    contactoEmergencia: null,
    representante: {
      nombre: 'Carla',
      apellidos: 'Hermanos',
      email: `carla.hermanos@${dominio}`,
      telefono: '+58 000 000 0016',
    },
    fechaIngreso: diaRelativo(-40),
    avisosActivos: true,
    activo: true,
    notas: '',
  },
  {
    id: 'a17',
    tipo: 'menor',
    nombre: 'Lucía',
    apellidos: 'Hermanos',
    nivel: 'principiante',
    email: null,
    telefono: null,
    documento: null,
    contactoEmergencia: null,
    representante: {
      nombre: 'Carla',
      apellidos: 'Hermanos',
      email: `carla.hermanos@${dominio}`,
      telefono: '+58 000 000 0016',
    },
    fechaIngreso: diaRelativo(-40),
    avisosActivos: true,
    activo: true,
    notas: '',
  },
]

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

function alumnoExtra(indice, diaRelativo) {
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

/** Todas las fichas de alumno que escribe el seed (base + `alumnosExtra`). */
function alumnosSeed(dominio, diaRelativo, alumnosExtra) {
  const extra = Array.from({ length: alumnosExtra }, (_, i) => alumnoExtra(i, diaRelativo))
  return { base: alumnosBase(dominio, diaRelativo), extra }
}

/** Snapshot de cobro sin ajuste: `montoCents` = `montoEstandarCents`. */
const cobroDe = (perfilCobroId, tarifaHoraCents, montoEstandarCents) => ({
  perfilCobroId,
  modo: 'total',
  tarifaHoraCents,
  montoEstandarCents,
  montoCents: montoEstandarCents,
  ajustado: false,
  motivoAjuste: null,
})

/**
 * Dataset completo del tenant `tenantId` con el reloj `ahora`.
 * `alumnosExtra` agrega fichas deterministas (ver `alumnoExtra`).
 * Devuelve `{ tenantId, tenantPath, docs: [{ path, data }], usuarios, resumen }`.
 */
export function construirSeed({ tenantId = 'ensayo', ahora = new Date(), alumnosExtra = 0 } = {}) {
  const perfil = PERFILES_TENANT[tenantId]
  if (!perfil) throw new Error(`Tenant de seed desconocido: "${tenantId}" (válidos: ${TENANTS_SEED.join(', ')})`)
  if (!(ahora instanceof Date) || Number.isNaN(ahora.getTime())) throw new Error('`ahora` debe ser una Date válida')

  const { dominio } = perfil
  const tenant = `academias/${tenantId}`
  const diaRelativo = (dias) => fechaRelativa(dias, ahora)
  const creadoEn = ahora
  const docs = []
  const set = (path, data) => docs.push({ path, data })

  const SEDES_POR_ID = Object.fromEntries(SEDES.map((sede) => [sede.id, sede]))
  const PROFESORES = profesoresDe(dominio)
  const PROFESORES_POR_ID = Object.fromEntries(PROFESORES.map((p) => [p.id, p]))
  const { base: ALUMNOS, extra: ALUMNOS_EXTRA } = alumnosSeed(dominio, diaRelativo, alumnosExtra)
  const ALUMNOS_SEED = [...ALUMNOS, ...ALUMNOS_EXTRA]
  const ALUMNOS_POR_ID = Object.fromEntries(ALUMNOS.map((alumno) => [alumno.id, alumno]))

  const usuarios = perfil.usuarios.map((u) => ({
    uid: `${tenantId}-${u.clave}`,
    email: `${u.email}@${dominio}`,
    password: perfil.password,
    nombre: u.nombre,
    rol: u.rol,
  }))
  const profesorUid = usuarios.find((u) => u.rol === 'profesor')?.uid ?? null

  /**
   * Clase con sus bloques de 30 min, reutilizando el mismo cálculo puro que usa
   * `crearClase` en src/firebase/db.js. El seed no corre la transacción del SDK;
   * reusa `bloquesDeClase` para que la clase sea dueña de sus bloques igual que
   * en la app. Horario: arranque en punto o a y media (múltiplo de 30), duración
   * 60/90/120 min y SIEMPRE dentro del horario del día de la sede (si la sede
   * está cerrada ese día, `bloquesDeClase` rechaza la clase).
   */
  function clase(datos) {
    const sede = SEDES_POR_ID[datos.sedeId]
    if (!sede) throw new Error(`La clase ${datos.id} del seed usa una sede desconocida: ${datos.sedeId}`)
    // Las clases de Traki salen de PLAN_CLASES (scripts/seed-plan.mjs), que fija su
    // fecha dentro del horario de su día. Aquí solo se verifica que no se desvíen.
    const plan = PLAN_POR_ID[datos.id]
    if (plan && ['canchaId', 'profesorId', 'horaInicio', 'horaFin'].some((k) => plan[k] !== datos[k])) {
      throw new Error(`La clase ${datos.id} del seed no coincide con PLAN_CLASES`)
    }
    const bloques = bloquesDeClase(datos, horarioDelDia(datos.fecha, sede.horario))
    const cupo = datos.cupo ?? 4
    // Ninguna clase del seed se siembra sin alumnos (misma regla que la app).
    if (!(datos.alumnosIds ?? []).length) {
      throw new Error(`La clase ${datos.id} del seed necesita al menos un alumno`)
    }
    // Mismo camino de validación/denormalización que `asignarAlumnos` en la app.
    const { alumnos, alumnoNombres } = resolverAsignacion(datos.alumnosIds ?? [], ALUMNOS_POR_ID, cupo)
    set(`${tenant}/clases/${datos.id}`, {
      tipo: 'variable',
      serieId: null,
      estado: datos.estado ?? 'reservada',
      facturada: datos.facturada ?? false,
      categoria: datos.categoria ?? null,
      categoriaGrupo: datos.categoriaGrupo ?? null,
      asistencias: datos.asistencias ?? [],
      alumnos,
      alumnoNombres,
      cupo,
      sedeId: datos.sedeId,
      sedeNombre: datos.sedeNombre ?? null,
      canchaId: datos.canchaId,
      canchaNombre: datos.canchaNombre ?? null,
      profesorId: datos.profesorId,
      profesorNombre: datos.profesorNombre ?? null,
      fecha: datos.fecha,
      horaInicio: datos.horaInicio,
      horaFin: datos.horaFin,
      bloques: bloques.map((b) => b.id),
      // Snapshot de cobro (opcional): mismo modelo que guarda `crearClase`.
      cobro: datos.cobro ?? null,
      // Asistencia YA cargada por el profesor (opcional): mismo modelo que guarda
      // `guardarAsistenciaProfesor` en la app (Fase 7).
      ...(datos.asistenciaProfesor ? { asistenciaProfesor: datos.asistenciaProfesor } : {}),
      creadoPor: 'seed',
      creadoEn,
    })
    for (const bloque of bloques) {
      set(`${tenant}/bloques/${bloque.id}`, { ...bloque.data, claseId: datos.id, creadoPor: 'seed', creadoEn })
    }
  }

  set(tenant, {
    nombre: perfil.nombre,
    slug: tenantId,
    estado: 'activa',
    plan: 'basico',
    zonaHoraria: 'America/Caracas',
    moneda: 'USD',
    creadoEn,
  })

  for (const sede of SEDES) {
    set(`${tenant}/sedes/${sede.id}`, {
      nombre: sede.nombre,
      direccion: `Sede ${sede.nombre}`,
      activa: true,
      orden: SEDES.indexOf(sede),
      horario: sede.horario,
      // Tarifas por perfil (centavos por hora). El seed NO escribe perfiles con
      // tarifa 0: una clave ausente ya significa "sin tarifa".
      tarifas: sede.tarifas,
    })
    for (let i = 1; i <= sede.canchas; i += 1) {
      set(`${tenant}/sedes/${sede.id}/canchas/c${i}`, {
        nombre: `Cancha ${i}`,
        numero: i,
        tipo: i % 2 === 0 ? 'outdoor' : 'indoor',
        activa: true,
      })
    }
  }

  /*
   * Perfiles de cobro: los defaults con `id` fijo (los mismos que reconoce la
   * app) y uno EXTRA inactivo para ejercitar el listado de inactivos y la
   * reactivación en Configuración → Cobros.
   */
  const PERFILES_SEED = [
    ...PERFILES_COBRO_DEFAULT.map((p) => ({ ...p, activo: true })),
    { id: 'clinica', nombre: 'Clínica', personas: null, modo: 'por_persona', activo: false, orden: 7 },
  ]
  for (const { id, ...datos } of PERFILES_SEED) {
    set(`${tenant}/perfilesCobro/${id}`, { ...datos, creadoPor: 'seed', creadoEn })
  }

  // Parámetros de la academia: defaults del modelo (`vencimientoCreditoDias` null = no vence).
  set(`${tenant}/config/parametros`, { ...PARAMETROS_DEFAULT, actualizadoPor: 'seed', actualizadoEn: creadoEn })

  // La tarifa por hora de los PROFESORES queda SIN DEFINIR (el pago se
  // configura en `config/parametros.pagoProfesor`, no en la ficha).
  for (const { id, ...ficha } of PROFESORES) set(`${tenant}/profesores/${id}`, ficha)

  for (const { id, ...ficha } of ALUMNOS_SEED) {
    set(`${tenant}/alumnos/${id}`, { ...ficha, ...camposBusqueda(ficha) })
  }

  /*
   * Todas las clases del seed van en Traki, arrancan en punto o a y media,
   * duran 60, 90 o 120 min, tienen al menos un alumno y caen SIEMPRE dentro del
   * horario de su día (Traki abre 7:30-15:30 entre semana, el sábado 8:00-13:00
   * y cierra los domingos: `planificarClases` elige el día más cercano donde la
   * clase cabe y no se solapa).
   */
  const FECHAS = planificarClases(SEDES_POR_ID.traki.horario, ahora)
  const ayerAbierto = FECHAS.c0 // c0, c2 y c4 caen el mismo día
  const p1 = {
    sedeId: 'traki',
    sedeNombre: 'Traki',
    profesorId: 'p1',
    profesorNombre: nombreCompleto(PROFESORES_POR_ID.p1),
  }
  const cancha = (n) => ({ canchaId: `c${n}`, canchaNombre: `Cancha ${n}` })
  const asistencia = (alumnoId, estado, motivo = null) => ({
    alumnoId,
    estado,
    motivo,
    registradoPor: 'seed',
    registradoEn: creadoEn,
  })

  // Fixture de la regla "no se reserva en el pasado": una clase reservada de un día pasado.
  clase({
    id: 'c0', ...p1, ...cancha(2), fecha: ayerAbierto, horaInicio: '09:00', horaFin: '10:00',
    cupo: 4, categoria: '4a', categoriaGrupo: 'adulto', alumnosIds: ['a1'], estado: 'reservada',
    cobro: cobroDe('cuatro', 7000, 7000),
  })

  // Clases de días PASADOS que quedaron ABIERTAS (`reservada`): la agenda las
  // marca como "sin cerrar" para la demo.
  clase({
    id: 'c5', ...p1, ...cancha(4), fecha: FECHAS.c5, horaInicio: '09:00', horaFin: '10:00',
    cupo: 4, categoria: '4a', categoriaGrupo: 'adulto', alumnosIds: ['a4', 'a8'], estado: 'reservada',
    cobro: cobroDe('pareja', 5000, 5000),
  })
  clase({
    id: 'c6', ...p1, ...cancha(5), fecha: FECHAS.c6, horaInicio: '10:30', horaFin: '12:00',
    cupo: 4, categoria: '6a', categoriaGrupo: 'junior', alumnosIds: ['a5', 'a7'], estado: 'reservada',
    cobro: cobroDe('pareja', 5000, 7500),
  })

  // Reserva futura con categoría de grupo: la grilla la muestra como
  // "Grupal · 6ta · Infantil" y el detalle trae la fila "Categoría de grupo".
  clase({
    id: 'c1', ...p1, ...cancha(1), fecha: FECHAS.c1, horaInicio: '10:00', horaFin: '11:00',
    cupo: 4, categoria: '6a', categoriaGrupo: 'infantil', alumnosIds: ['a1'], estado: 'reservada',
    cobro: cobroDe('cuatro', 7000, 7000),
  })

  // Clase cerrada (pendiente de cobro) con cobro AJUSTADO a mano: ejercita el
  // badge "Descuento" en el detalle.
  clase({
    id: 'c2', ...p1, ...cancha(1), fecha: FECHAS.c2, horaInicio: '11:00', horaFin: '12:00',
    cupo: 4, categoria: '7a', alumnosIds: ['a1', 'a2'],
    asistencias: [asistencia('a1', 'presente'), asistencia('a2', 'ausente_sin_aviso', 'enfermedad')],
    estado: 'pendiente_cobro',
    facturada: true,
    cobro: { ...cobroDe('cuatro', 7000, 7000), montoCents: 4000, ajustado: true, motivoAjuste: 'descuento' },
  })

  // Clase de 90 min que ARRANCA A Y MEDIA (11:30-13:00): fixture de la grilla de
  // media hora. Pareja, 90 min a $50.00/h → 7500 centavos.
  clase({
    id: 'c3', ...p1, ...cancha(2), fecha: FECHAS.c3, horaInicio: '11:30', horaFin: '13:00',
    cupo: 2, categoria: '5a', categoriaGrupo: 'junior', alumnosIds: ['a1', 'a2'], estado: 'reservada',
    cobro: cobroDe('pareja', 5000, 7500),
  })

  /*
   * Cargos y pago al profesor del cierre de la clase c2 (Phase 4): monto
   * AJUSTADO de $40.00 entre 2 alumnos. a1 presente → cargo `clase` de $20.00
   * YA PAGADO; a2 sin aviso → `falta_sin_aviso` del 50% de su parte = $10.00.
   * El pago al profesor (por hora, $15.00/h, 60 min) queda PENDIENTE. IDs
   * deterministas, igual que en `cerrarClase` de db.js.
   */
  set(`${tenant}/cargos/c2_a1`, {
    claseId: 'c2', alumnoId: 'a1', alumnoNombre: 'Aldo Adulto', sedeId: 'traki', fecha: ayerAbierto,
    concepto: 'clase', montoCents: 2000, estado: 'pagado', pagadoEn: creadoEn, metodoPago: 'efectivo', creadoEn,
  })
  set(`${tenant}/cargos/c2_a2`, {
    claseId: 'c2', alumnoId: 'a2', alumnoNombre: 'Marta Menor', sedeId: 'traki', fecha: ayerAbierto,
    concepto: 'falta_sin_aviso', montoCents: 1000, estado: 'pendiente', pagadoEn: null, metodoPago: null, creadoEn,
  })
  const pagoProfesor = (claseId) => ({
    claseId,
    profesorId: 'p1',
    profesorNombre: nombreCompleto(PROFESORES_POR_ID.p1),
    sedeId: 'traki',
    fecha: ayerAbierto,
    montoCents: 1500,
    base: { modo: 'por_hora', minutos: 60 },
    estado: 'pendiente',
    pagadoEn: null,
    metodoPago: null,
  })
  set(`${tenant}/pagosProfesor/c2`, pagoProfesor('c2'))

  /*
   * Mensualidades y créditos (Phase 5).
   * - a1 (adulto): plan activo y un lote parcialmente usado por la clase c4.
   * - a16/a17 (hermanos, mismo representante): plan de a16 con descuento de hermanos.
   * - a14: plan con un lote YA VENCIDO.
   */
  const PLANES_SEED = [
    { id: 'plan-a1', alumnoId: 'a1', nombre: 'Mensual 8 horas', frecuencia: 'mensual', minutosIncluidos: 480, precioCents: 8000, descuentoHermanos: false, activo: true },
    { id: 'plan-a16', alumnoId: 'a16', nombre: 'Mensual 8 horas (hermanos)', frecuencia: 'mensual', minutosIncluidos: 480, precioCents: 8000, descuentoHermanos: true, activo: true },
    { id: 'plan-a14', alumnoId: 'a14', nombre: 'Mensual 4 horas', frecuencia: 'mensual', minutosIncluidos: 240, precioCents: 4500, descuentoHermanos: false, activo: true },
  ]
  for (const { id, ...datos } of PLANES_SEED) set(`${tenant}/planesAlumno/${id}`, { ...datos, creadoEn })

  const CREDITOS_SEED = [
    { id: 'cred-a1', alumnoId: 'a1', planId: 'plan-a1', minutosComprados: 480, minutosUsados: 60, inicio: ayerAbierto, venceEn: null, cargoId: 'men_cred-a1', estado: 'activo' },
    { id: 'cred-a16', alumnoId: 'a16', planId: 'plan-a16', minutosComprados: 480, minutosUsados: 0, inicio: diaRelativo(0), venceEn: null, cargoId: 'men_cred-a16', estado: 'activo' },
    { id: 'cred-a14', alumnoId: 'a14', planId: 'plan-a14', minutosComprados: 240, minutosUsados: 0, inicio: diaRelativo(-30), venceEn: diaRelativo(-5), cargoId: 'men_cred-a14', estado: 'vencido' },
  ]
  for (const { id, ...datos } of CREDITOS_SEED) set(`${tenant}/creditos/${id}`, { ...datos, creadoEn })

  const CARGOS_MENSUALIDAD = [
    // Pagado replica la forma de `marcarCargoPagado` (Fase 4): así el crédito
    // `cred-a1` es usable con `creditoRequierePago: true` (default).
    { id: 'men_cred-a1', alumnoId: 'a1', creditoId: 'cred-a1', planId: 'plan-a1', planNombre: 'Mensual 8 horas', montoCents: 8000, fecha: ayerAbierto, estado: 'pagado', pagadoEn: creadoEn, metodoPago: 'efectivo' },
    { id: 'men_cred-a16', alumnoId: 'a16', creditoId: 'cred-a16', planId: 'plan-a16', planNombre: 'Mensual 8 horas (hermanos)', montoCents: 7200, fecha: diaRelativo(0) },
    { id: 'men_cred-a14', alumnoId: 'a14', creditoId: 'cred-a14', planId: 'plan-a14', planNombre: 'Mensual 4 horas', montoCents: 4500, fecha: diaRelativo(-30) },
  ]
  for (const { id, alumnoId, ...resto } of CARGOS_MENSUALIDAD) {
    set(`${tenant}/cargos/${id}`, {
      claseId: null,
      alumnoId,
      alumnoNombre: nombreCompleto(ALUMNOS_POR_ID[alumnoId]),
      sedeId: null,
      concepto: 'mensualidad',
      estado: 'pendiente',
      pagadoEn: null,
      metodoPago: null,
      ...resto,
      creadoEn,
    })
  }

  // Clase c4 CERRADA y cubierta por crédito: a1 presente, sin cargo, con el
  // movimiento `c4_a1` y el pago al profesor pendiente.
  clase({
    id: 'c4', ...p1, ...cancha(3), fecha: FECHAS.c4, horaInicio: '12:00', horaFin: '13:00',
    cupo: 4, categoria: '4a', alumnosIds: ['a1'], asistencias: [asistencia('a1', 'presente')],
    estado: 'pendiente_cobro', facturada: true, cobro: cobroDe('cuatro', 7000, 7000),
  })
  set(`${tenant}/movimientosCredito/c4_a1`, {
    claseId: 'c4', alumnoId: 'a1', minutos: 60, asignaciones: [{ creditoId: 'cred-a1', minutos: 60 }], motivo: 'clase', creadoEn,
  })
  set(`${tenant}/pagosProfesor/c4`, pagoProfesor('c4'))

  // Accesos: el profesor SOLO en `usuarios` (ligado a su ficha); el resto en `miembros`.
  for (const usuario of usuarios) {
    if (usuario.rol === 'profesor') {
      const ficha = PROFESORES.find((p) => p.email === usuario.email)
      set(`${tenant}/usuarios/${usuario.uid}`, {
        uid: usuario.uid, rol: 'profesor', profesorId: ficha?.id ?? null, email: usuario.email, activo: true, creadoEn,
      })
    } else {
      set(`${tenant}/miembros/${usuario.uid}`, {
        uid: usuario.uid, rol: usuario.rol, activo: true, nombre: usuario.nombre, creadoEn,
      })
    }
  }

  /*
   * Clases de demo del FLUJO DE CIERRE: días PASADOS que quedaron ABIERTAS.
   * - ca: el profesor YA cargó la asistencia (asistenciaProfesor).
   * - cb: un alumno PRESENTE y otro FALTA SIN AVISO sin crédito.
   * - cc: TODOS avisaron su ausencia → sin cargos ni pago al profesor.
   * - cd: a1 PRESENTE con crédito suficiente → consume el lote, sin cargo.
   */
  const cobroPareja = cobroDe('pareja', 5000, 5000)
  clase({
    id: 'ca', ...p1, ...cancha(1), fecha: FECHAS.ca, horaInicio: '09:00', horaFin: '10:00',
    cupo: 2, categoria: '4a', categoriaGrupo: 'adulto', alumnosIds: ['a5', 'a7'], estado: 'reservada', cobro: cobroPareja,
    asistenciaProfesor: { porAlumno: { a5: 'presente', a7: 'presente' }, registradoPor: profesorUid, registradoEn: creadoEn },
  })
  clase({
    id: 'cb', ...p1, ...cancha(1), fecha: FECHAS.cb, horaInicio: '10:30', horaFin: '11:30',
    cupo: 2, categoria: '5a', categoriaGrupo: 'junior', alumnosIds: ['a5', 'a7'],
    asistencias: [asistencia('a5', 'presente'), asistencia('a7', 'ausente_sin_aviso', 'no avisó')],
    estado: 'reservada', cobro: cobroPareja,
  })
  clase({
    id: 'cc', ...p1, ...cancha(1), fecha: FECHAS.cc, horaInicio: '13:00', horaFin: '14:00',
    cupo: 2, categoria: '6a', categoriaGrupo: 'junior', alumnosIds: ['a5', 'a7'],
    asistencias: [asistencia('a5', 'ausente_avisada', 'viaje'), asistencia('a7', 'ausente_avisada', 'estudios')],
    estado: 'reservada', cobro: cobroPareja,
  })
  clase({
    id: 'cd', ...p1, ...cancha(1), fecha: FECHAS.cd, horaInicio: '14:30', horaFin: '15:30',
    cupo: 2, categoria: '4a', categoriaGrupo: 'adulto', alumnosIds: ['a1'], asistencias: [asistencia('a1', 'presente')],
    estado: 'reservada', cobro: cobroDe('cuatro', 7000, 7000),
  })

  for (const { path } of docs) {
    if (path !== tenant && !path.startsWith(`${tenant}/`)) throw new Error(`Seed fuera del tenant: ${path}`)
  }

  return {
    tenantId,
    tenantPath: tenant,
    docs,
    usuarios,
    resumen: {
      sedes: SEDES.map((s) => ({ nombre: s.nombre, canchas: s.canchas })),
      alumnosBase: ALUMNOS.length,
      alumnosExtra: ALUMNOS_EXTRA.length,
      perfilesCobro: PERFILES_SEED.length,
    },
  }
}

/** Conteo de documentos por colección (último segmento de colección de cada path). */
export function contarPorColeccion(docs) {
  const conteo = {}
  for (const { path } of docs) {
    const seg = path.split('/')
    const coleccion = seg.length === 2 ? seg[0] : seg.slice(2).filter((_, i) => i % 2 === 0).join('/')
    conteo[coleccion] = (conteo[coleccion] ?? 0) + 1
  }
  return conteo
}
