import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { horarioDelDia } from '../src/lib/agenda.js'
import { PLAN_CLASES, cabeEnHorario, fechaRelativa, planificarClases } from '../../../scripts/seed-plan.mjs'
import { TENANTS_SEED, construirSeed, contarPorColeccion } from '../../../scripts/seed-data.mjs'

// Horario semanal de Traki tal como lo siembra scripts/seed-data.mjs (0 = lunes … 6 = domingo).
const franja = (apertura, cierre) => ({ apertura: Math.round(apertura * 60), cierre: Math.round(cierre * 60) })
const HORARIO_TRAKI = {
  0: franja(7.5, 15.5),
  1: franja(7.5, 15.5),
  2: franja(7.5, 15.5),
  3: franja(7.5, 15.5),
  4: franja(7.5, 15.5),
  5: franja(8, 13),
  6: null,
}

const aMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// 2026-10-19 es lunes: 14 días consecutivos cubren cada día de la semana dos veces.
const RELOJES = Array.from({ length: 14 }, (_, i) => new Date(2026, 9, 19 + i, 9, 0, 0))

describe('planificación de fechas del seed', () => {
  it('fechaRelativa usa partes locales y respeta el reloj inyectado', () => {
    assert.equal(fechaRelativa(0, new Date(2026, 9, 23, 23, 30)), '2026-10-23')
    assert.equal(fechaRelativa(-6, new Date(2026, 9, 23)), '2026-10-17')
  })

  for (const hoy of RELOJES) {
    const nombre = hoy.toLocaleDateString('en-US', { weekday: 'long' })
    it(`${hoy.getFullYear()}-${hoy.getMonth() + 1}-${hoy.getDate()} (${nombre}): toda clase cae dentro del horario de su día`, () => {
      const fechas = planificarClases(HORARIO_TRAKI, hoy)
      assert.equal(Object.keys(fechas).length, PLAN_CLASES.length)
      for (const clase of PLAN_CLASES) {
        const fecha = fechas[clase.id]
        const franjaDia = horarioDelDia(fecha, HORARIO_TRAKI)
        assert.ok(franjaDia, `${clase.id} cae en ${fecha}: sede cerrada`)
        assert.ok(aMin(clase.horaInicio) >= franjaDia.apertura, `${clase.id} empieza antes de abrir (${fecha})`)
        assert.ok(aMin(clase.horaFin) <= franjaDia.cierre, `${clase.id} termina después de cerrar (${fecha})`)
        assert.ok(cabeEnHorario(fecha, clase, HORARIO_TRAKI))
      }
    })

    it(`${nombre} ${hoy.getDate()}: pasadas en el pasado, futuras en el futuro, sin solapes y c0/c2/c4 el mismo día`, () => {
      const fechas = planificarClases(HORARIO_TRAKI, hoy)
      const hoyISO = fechaRelativa(0, hoy)
      for (const clase of PLAN_CLASES) {
        if (clase.dias < 0) assert.ok(fechas[clase.id] < hoyISO, `${clase.id} debería ser pasada`)
        else assert.ok(fechas[clase.id] > hoyISO, `${clase.id} debería ser futura`)
      }
      assert.equal(fechas.c0, fechas.c2)
      assert.equal(fechas.c0, fechas.c4)
      for (const a of PLAN_CLASES) {
        for (const b of PLAN_CLASES) {
          if (a.id >= b.id || fechas[a.id] !== fechas[b.id]) continue
          const comparten = a.canchaId === b.canchaId || a.profesorId === b.profesorId
          const solapan = aMin(a.horaInicio) < aMin(b.horaFin) && aMin(b.horaInicio) < aMin(a.horaFin)
          assert.ok(!(comparten && solapan), `${a.id} y ${b.id} se solapan el ${fechas[a.id]}`)
        }
      }
    })
  }

  it('falla con claridad si una clase no cabe en ningún día', () => {
    const plan = [{ id: 'x', dias: -1, canchaId: 'c1', profesorId: 'p1', horaInicio: '20:00', horaFin: '21:00' }]
    assert.throws(() => planificarClases(HORARIO_TRAKI, RELOJES[0], plan), /no cabe en ningún día/)
  })
})

describe('constructor puro del seed (scripts/seed-data.mjs)', () => {
  const AHORA = new Date(2026, 9, 23, 10, 0, 0)
  const ensayo = construirSeed({ tenantId: 'ensayo', ahora: AHORA })
  const demo = construirSeed({ tenantId: 'demo', ahora: AHORA })
  const COLECCIONES_DE_USUARIOS = new Set(['miembros', 'usuarios'])
  const sinUsuarios = (seed) =>
    seed.docs
      .map(({ path }) => path.split('/').slice(2).join('/'))
      .filter((rel) => !COLECCIONES_DE_USUARIOS.has(rel.split('/')[0]))
      .sort()

  it('"ensayo" y "demo" tienen la misma forma (colecciones e ids, salvo los accesos)', () => {
    assert.deepEqual(sinUsuarios(ensayo), sinUsuarios(demo))
    const conteoE = contarPorColeccion(ensayo.docs)
    const conteoD = contarPorColeccion(demo.docs)
    assert.deepEqual(Object.keys(conteoE).sort(), Object.keys(conteoD).sort())
    for (const coleccion of Object.keys(conteoE)) {
      if (!COLECCIONES_DE_USUARIOS.has(coleccion)) assert.equal(conteoE[coleccion], conteoD[coleccion], coleccion)
    }
    assert.equal(conteoE.clases, 11)
    assert.equal(conteoE.alumnos, 17)
    assert.equal(conteoE['sedes/canchas'], 15)
  })

  for (const seed of [ensayo, demo]) {
    it(`"${seed.tenantId}": todo path vive bajo academias/${seed.tenantId}/ y ningún dato cruza de tenant`, () => {
      const otro = seed.tenantId === 'demo' ? 'ensayo' : 'demo'
      assert.equal(seed.tenantPath, `academias/${seed.tenantId}`)
      for (const { path, data } of seed.docs) {
        assert.ok(path === seed.tenantPath || path.startsWith(`${seed.tenantPath}/`), path)
        assert.equal(path.split('/').length % 2, 0, `${path} no es un documento`)
        const texto = JSON.stringify(data)
        assert.ok(!texto.includes(`academias/${otro}`), `${path} menciona academias/${otro}`)
        assert.ok(!texto.includes(`"${otro}-`), `${path} usa un uid de ${otro}`)
      }
      assert.equal(new Set(seed.docs.map((d) => d.path)).size, seed.docs.length, 'paths duplicados')
    })

    it(`"${seed.tenantId}": sin valores undefined (la nube los rechaza)`, () => {
      const buscar = (valor, ruta) => {
        assert.notEqual(valor, undefined, ruta)
        if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
          for (const [k, v] of Object.entries(valor)) buscar(v, `${ruta}.${k}`)
        }
      }
      for (const { path, data } of seed.docs) buscar(data, path)
    })

    it(`"${seed.tenantId}": cada usuario de Auth tiene uid fijo del tenant y su acceso en miembros/usuarios`, () => {
      const dominio = seed.tenantId === 'demo' ? 'demo.academia-padel.app' : 'ensayo.test'
      for (const u of seed.usuarios) {
        assert.ok(u.uid.startsWith(`${seed.tenantId}-`), u.uid)
        assert.ok(u.email.endsWith(`@${dominio}`), u.email)
        assert.ok(u.password.length >= 6)
        const coleccion = u.rol === 'profesor' ? 'usuarios' : 'miembros'
        const acceso = seed.docs.find((d) => d.path === `${seed.tenantPath}/${coleccion}/${u.uid}`)
        assert.ok(acceso, `${u.email} sin doc en ${coleccion}`)
        assert.equal(acceso.data.uid, u.uid)
      }
      const profe = seed.usuarios.find((u) => u.rol === 'profesor')
      const ficha = seed.docs.find((d) => d.path === `${seed.tenantPath}/profesores/p1`)
      assert.equal(ficha.data.email, profe.email)
    })
  }

  it('"demo" tiene exactamente un administrador ("Admin Demo") y un profesor', () => {
    assert.deepEqual(
      demo.usuarios.map((u) => [u.rol, u.email, u.uid]),
      [
        ['administrador', 'admin@demo.academia-padel.app', 'demo-admin'],
        ['profesor', 'profe@demo.academia-padel.app', 'demo-profe'],
      ],
    )
    assert.equal(demo.usuarios[0].nombre, 'Admin Demo')
    assert.equal(demo.docs.find((d) => d.path === 'academias/demo').data.slug, 'demo')
  })

  it('el reloj inyectado fija fechas y creadoEn (mismo reloj → mismo dataset)', () => {
    const otraVez = construirSeed({ tenantId: 'ensayo', ahora: new Date(AHORA.getTime()) })
    assert.deepEqual(otraVez.docs, ensayo.docs)
    const tenant = ensayo.docs.find((d) => d.path === 'academias/ensayo')
    assert.equal(tenant.data.creadoEn.getTime(), AHORA.getTime())
    const fechas = planificarClases(HORARIO_TRAKI, AHORA)
    assert.equal(ensayo.docs.find((d) => d.path === 'academias/ensayo/clases/c0').data.fecha, fechas.c0)
  })

  it('alumnosExtra agrega fichas deterministas y rechaza tenants desconocidos', () => {
    const conExtra = construirSeed({ tenantId: 'ensayo', ahora: AHORA, alumnosExtra: 3 })
    assert.equal(contarPorColeccion(conExtra.docs).alumnos, 20)
    assert.ok(conExtra.docs.some((d) => d.path === 'academias/ensayo/alumnos/extra-0003'))
    assert.throws(() => construirSeed({ tenantId: 'otra', ahora: AHORA }), /Tenant de seed desconocido/)
    assert.deepEqual(TENANTS_SEED, ['ensayo', 'demo'])
  })
})
