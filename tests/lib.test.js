/*
 * Pruebas de helpers puros (sin Firestore ni emulador).
 *
 *   npm run test:lib
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  contarSinCerrar,
  diaDeFecha,
  esHuecoReservable,
  estaSinCerrar,
  etiquetaCategoria,
  etiquetaDia,
  etiquetaDuracion,
  formatHora12,
  formatMinutos,
  franjaValida,
  horarioDeSede,
  horarioDelDia,
  huecoDeClic,
  huecoLibre,
  lineasDeFranja,
  modalidadDeClase,
  opcionesDeInicio,
  rangoHorasAgenda,
  tituloClase,
} from '../src/lib/agenda.js'
import { aISO, hoyISO } from '../src/lib/fechas.js'
// Helpers puros de db.js: no tocan Firestore, así que se prueban acá sin emulador.
import { claveNombreCancha, normalizarNombreCancha } from '../src/firebase/db.js'

/** Franja de un día en minutos, como la guarda una sede. */
const dia = (aperturaHoras, cierreHoras) => ({
  apertura: Math.round(aperturaHoras * 60),
  cierre: Math.round(cierreHoras * 60),
})

/*
 * Horario de una sede que ilustra la Fase 2: lunes a viernes 7:30-15:30, sábado
 * 8:00-13:00 y domingo CERRADO. Claves 0 = lunes … 6 = domingo.
 */
const SEMANA_MEDIA_HORA = {
  0: dia(7.5, 15.5),
  1: dia(7.5, 15.5),
  2: dia(7.5, 15.5),
  3: dia(7.5, 15.5),
  4: dia(7.5, 15.5),
  5: dia(8, 13),
  6: null,
}

/** Sede con ese horario, como la lee `horarioDeSede`. */
const SEDE_MEDIA_HORA = { nombre: 'Traki', horario: SEMANA_MEDIA_HORA }

// Fechas conocidas: 2026-11-14 sábado, 2026-11-15 domingo, 2026-11-16 lunes.
const SABADO = '2026-11-14'
const DOMINGO = '2026-11-15'
const LUNES = '2026-11-16'

describe('horas de inicio de una reserva', () => {
  it('cada 30 min de 07:00 a 23:00 según la duración (franja default)', () => {
    const unaHora = opcionesDeInicio(60)
    const horaYMedia = opcionesDeInicio(90)
    const dosHoras = opcionesDeInicio(120)

    assert.equal(unaHora[0], '07:00')
    assert.equal(horaYMedia[0], '07:00')
    assert.equal(dosHoras[0], '07:00')
    // Última hora de inicio: 22:00 con 1 h, 21:30 con 1 h 30 y 21:00 con 2 h.
    assert.equal(unaHora[unaHora.length - 1], '22:00')
    assert.equal(horaYMedia[horaYMedia.length - 1], '21:30')
    assert.equal(dosHoras[dosHoras.length - 1], '21:00')
    // El paso es de 30 min: hay medias horas y también horas en punto.
    assert.ok(unaHora.includes('21:30'))
    assert.ok(unaHora.includes('21:00'))
    // Una duración que no cabe antes del cierre no se ofrece.
    assert.ok(!dosHoras.includes('22:00'))
    assert.ok(!horaYMedia.includes('22:00'))
    // Todos los inicios caen en la grilla de 30 min.
    assert.ok(unaHora.every((hora) => Number(hora.slice(3)) % 30 === 0))
  })

  it('la duración de 90 min ofrece 30 opciones (07:00 a 21:30 cada 30 min)', () => {
    const horaYMedia = opcionesDeInicio(90)
    assert.equal(horaYMedia.length, 30)
    assert.equal(horaYMedia[0], '07:00')
    assert.equal(horaYMedia[1], '07:30')
  })

  it('una sede que abre y cierra a y media: 7:30-15:30', () => {
    const franja = { apertura: 450, cierre: 930 }
    const unaHora = opcionesDeInicio(60, franja)
    // La grilla arranca en la apertura EXACTA y el último inicio cabe antes del
    // cierre exacto.
    assert.equal(unaHora[0], '07:30')
    assert.equal(unaHora[1], '08:00')
    assert.equal(unaHora[unaHora.length - 1], '14:30')
    assert.ok(!unaHora.includes('07:00'))
    assert.ok(!unaHora.includes('15:00'))
  })

  it('una clase de 90 min que no cabe antes del cierre no se ofrece', () => {
    // Con cierre 15:30 el último inicio de 90 min es 14:00 (termina 15:30).
    const horaYMedia = opcionesDeInicio(90, { apertura: 450, cierre: 930 })
    assert.equal(horaYMedia[0], '07:30')
    assert.equal(horaYMedia[horaYMedia.length - 1], '14:00')
    assert.ok(!horaYMedia.includes('14:30'))
    // Y con 2 h el último es 13:30.
    const dosHoras = opcionesDeInicio(120, { apertura: 450, cierre: 930 })
    assert.equal(dosHoras[dosHoras.length - 1], '13:30')
    assert.ok(!dosHoras.includes('14:00'))
  })

  it('un día CERRADO no ofrece ninguna hora de inicio', () => {
    assert.deepEqual(opcionesDeInicio(60, null), [])
    assert.deepEqual(opcionesDeInicio(90, null), [])
    assert.deepEqual(opcionesDeInicio(60, null, [{ estado: 'reservada', horaInicio: '08:00', horaFin: '09:00' }]), [])
  })

  it('cerca del cierre, una duración de 90 min ya no ofrece el inicio que se pasa', () => {
    // Sede que cierra a las 20:00: con 90 min el último inicio es 18:30.
    const horaYMedia = opcionesDeInicio(90, { apertura: 540, cierre: 1200 })
    assert.equal(horaYMedia[0], '09:00')
    assert.equal(horaYMedia[horaYMedia.length - 1], '18:30')
    assert.ok(!horaYMedia.includes('19:00'))
    assert.ok(!horaYMedia.includes('19:30'))
    assert.ok(horaYMedia.includes('18:00'))
    assert.ok(horaYMedia.includes('18:30'))
  })

  it('descarta los inicios que chocan con las clases ya cargadas', () => {
    // 18:00-19:00 ocupada: con 1 h no se puede empezar 18:00 ni 18:30, pero sí
    // 19:00 (borde exacto: no se solapa).
    const ocupadas = [{ estado: 'reservada', horaInicio: '18:00', horaFin: '19:00' }]
    const unaHora = opcionesDeInicio(60, { apertura: 420, cierre: 1380 }, ocupadas)
    assert.ok(!unaHora.includes('18:00'))
    assert.ok(!unaHora.includes('18:30'))
    assert.ok(unaHora.includes('19:00'))
    assert.ok(unaHora.includes('17:00'))
    // Con 90 min, 17:30-19:00 tampoco entra, y 17:00-18:30 tampoco (pisa 18:00).
    const horaYMedia = opcionesDeInicio(90, { apertura: 420, cierre: 1380 }, ocupadas)
    assert.ok(!horaYMedia.includes('17:30'))
    assert.ok(!horaYMedia.includes('17:00'))
    // 16:30-18:00 termina justo cuando la otra empieza: sí entra.
    assert.ok(horaYMedia.includes('16:30'))
    // 19:00-20:30 arranca cuando la otra termina: sí entra.
    assert.ok(horaYMedia.includes('19:00'))
  })

  it('una clase cancelada no descarta ninguna hora de inicio', () => {
    const ocupadas = [{ estado: 'cancelada', horaInicio: '18:00', horaFin: '19:00' }]
    assert.ok(opcionesDeInicio(60, { apertura: 420, cierre: 1380 }, ocupadas).includes('18:00'))
  })

  it('sin duración válida no ofrece ninguna hora', () => {
    assert.deepEqual(opcionesDeInicio(0), [])
    assert.deepEqual(opcionesDeInicio(-60), [])
  })

  it('con el horario del día, la franja arranca en la apertura y cierra en el cierre', () => {
    const unaHora = opcionesDeInicio(60, { apertura: 540, cierre: 1200 })
    assert.equal(unaHora[0], '09:00')
    assert.equal(unaHora[unaHora.length - 1], '19:00')

    const dosHoras = opcionesDeInicio(120, { apertura: 540, cierre: 1200 })
    assert.equal(dosHoras[0], '09:00')
    assert.equal(dosHoras[dosHoras.length - 1], '18:00')

    // Cierre 24:00: el formato HH:mm no expresa las 24:00, así que la última
    // hora de inicio es la que termina a las 23:30.
    const hastaMedianoche = opcionesDeInicio(60, { apertura: 0, cierre: 1440 })
    assert.equal(hastaMedianoche[0], '00:00')
    assert.equal(hastaMedianoche[hastaMedianoche.length - 1], '22:30')
  })

  it('una franja ilegible cae al default 07:00-23:00', () => {
    for (const franjaMala of [undefined, {}, { apertura: '9', cierre: 20 }, { apertura: 20, cierre: 8 }, 7]) {
      const unaHora = opcionesDeInicio(60, franjaMala)
      assert.equal(unaHora[0], '07:00', JSON.stringify(franjaMala))
      assert.equal(unaHora[unaHora.length - 1], '22:00', JSON.stringify(franjaMala))
    }
  })
})

describe('etiqueta de duración', () => {
  it('horas exactas y medias horas', () => {
    assert.equal(etiquetaDuracion(60), '1 h')
    assert.equal(etiquetaDuracion(90), '1 h 30 min')
    assert.equal(etiquetaDuracion(120), '2 h')
    assert.equal(etiquetaDuracion(30), '30 min')
  })

  it('un valor inválido devuelve cadena vacía', () => {
    assert.equal(etiquetaDuracion(0), '')
    assert.equal(etiquetaDuracion(-60), '')
    assert.equal(etiquetaDuracion(null), '')
  })
})

/*
 * Rango vertical de la grilla de la agenda, EN MINUTOS: la franja del día
 * (apertura → min(cierre, 23:30)) extendida para que ninguna clase NO cancelada
 * quede fuera.
 */
describe('rango de horas de la agenda', () => {
  const claseEn = (horaInicio, horaFin, extra = {}) => ({
    estado: 'reservada',
    horaInicio,
    horaFin,
    ...extra,
  })

  it('sin clases, el rango es el del día y sin franja cae al default 7-23', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 420, cierre: 1380 }, []), {
      minutoInicio: 420,
      minutoFin: 1380,
    })
    assert.deepEqual(rangoHorasAgenda(undefined, []), { minutoInicio: 420, minutoFin: 1380 })
  })

  it('sigue la apertura y el cierre del día (9-20)', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 540, cierre: 1200 }, []), {
      minutoInicio: 540,
      minutoFin: 1200,
    })
  })

  it('la grilla arranca y termina en la media hora exacta (7:30-15:30)', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 450, cierre: 930 }, []), {
      minutoInicio: 450,
      minutoFin: 930,
    })
    // Las líneas van cada 30 min desde la apertura, con la media hora marcada.
    const lineas = lineasDeFranja({ minutoInicio: 450, minutoFin: 930 })
    assert.equal(lineas[0].minuto, 450)
    assert.equal(lineas[0].horaEntera, false)
    assert.equal(lineas[1].minuto, 480)
    assert.equal(lineas[1].horaEntera, true)
    assert.equal(lineas[lineas.length - 1].minuto, 930)
  })

  it('con cierre 24:00 el fin efectivo es 23:30 (último fin expresable)', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 420, cierre: 1440 }, []), {
      minutoInicio: 420,
      minutoFin: 1410,
    })
  })

  it('un día CERRADO no tiene franja: dibuja el default y no agranda por clases', () => {
    assert.deepEqual(rangoHorasAgenda(null, []), { minutoInicio: 420, minutoFin: 1380 })
  })

  it('una clase guardada en un día CERRADO igual se dibuja (nunca queda invisible)', () => {
    assert.deepEqual(rangoHorasAgenda(null, [claseEn('09:00', '10:00')]), {
      minutoInicio: 420,
      minutoFin: 1380,
    })
    // Una clase fuera del default sí agranda el rango aunque el día esté cerrado.
    assert.deepEqual(rangoHorasAgenda(null, [claseEn('06:00', '07:00')]), {
      minutoInicio: 360,
      minutoFin: 1380,
    })
  })

  it('una clase de 21:00 a 22:00 adentro del rango default no lo agranda', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 420, cierre: 1380 }, [claseEn('21:00', '22:00')]), {
      minutoInicio: 420,
      minutoFin: 1380,
    })
  })

  it('una clase a las 07:00 con apertura 9 extiende el inicio', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 540, cierre: 1200 }, [claseEn('07:00', '08:00')]), {
      minutoInicio: 420,
      minutoFin: 1200,
    })
  })

  it('una clase que termina después del cierre extiende el fin', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 540, cierre: 1200 }, [claseEn('20:00', '21:00')]), {
      minutoInicio: 540,
      minutoFin: 1260,
    })
  })

  it('un inicio a y media fuera de la franja redondea hacia afuera al bloque', () => {
    assert.deepEqual(
      rangoHorasAgenda({ apertura: 540, cierre: 1200 }, [claseEn('08:30', '09:30')]),
      { minutoInicio: 510, minutoFin: 1200 },
    )
  })

  it('una clase cancelada fuera del rango NO lo extiende', () => {
    const canceladas = [
      claseEn('07:00', '08:00', { estado: 'cancelada' }),
      claseEn('21:00', '22:00', { estado: 'cancelada' }),
    ]
    assert.deepEqual(rangoHorasAgenda({ apertura: 540, cierre: 1200 }, canceladas), {
      minutoInicio: 540,
      minutoFin: 1200,
    })
  })

  it('horario faltante o corrupto → default 7-23', () => {
    const corruptos = [
      undefined,
      {},
      { apertura: '9', cierre: 20 },
      { apertura: 20, cierre: 8 },
      { apertura: 420, cierre: 1500 },
      { apertura: -30, cierre: 1200 },
      7,
      'x',
    ]
    for (const franjaMala of corruptos) {
      assert.deepEqual(
        rangoHorasAgenda(franjaMala, []),
        { minutoInicio: 420, minutoFin: 1380 },
        `franja: ${JSON.stringify(franjaMala)}`,
      )
    }
  })

  it('ignora una clase con horas corruptas (no rompe la grilla)', () => {
    const rotas = [claseEn('25:00', '26:00'), claseEn(null, null), claseEn('20:00', '19:00')]
    assert.deepEqual(rangoHorasAgenda({ apertura: 540, cierre: 1200 }, rotas), {
      minutoInicio: 540,
      minutoFin: 1200,
    })
  })
})

/*
 * Modelo del horario de una sede: mapa de 7 días (0 = lunes … 6 = domingo) con
 * la franja del día en MINUTOS o `null` (cerrado). Compatibilidad con el formato
 * viejo (un par de horas enteras) y default 07:00-23:00.
 */
describe('horario de la sede por día de la semana', () => {
  it('acepta el formato nuevo tal cual (con días cerrados)', () => {
    const semana = horarioDeSede(SEDE_MEDIA_HORA)
    assert.deepEqual(semana[0], { apertura: 450, cierre: 930 })
    assert.equal(semana[6], null)
    assert.deepEqual(semana[5], { apertura: 480, cierre: 780 })
  })

  it('expande el formato VIEJO de horas enteras a los 7 días', () => {
    const semana = horarioDeSede({ horario: { apertura: 8, cierre: 20 } })
    for (const diaSemana of [0, 1, 2, 3, 4, 5, 6]) {
      assert.deepEqual(semana[diaSemana], { apertura: 480, cierre: 1200 })
    }
    // Con cierre 24 el formato viejo equivalía a medianoche (1440).
    assert.deepEqual(horarioDeSede({ horario: { apertura: 0, cierre: 24 } })[0], {
      apertura: 0,
      cierre: 1440,
    })
  })

  it('sin horario o con datos corruptos cae al default 07:00-23:00 los 7 días', () => {
    const corruptos = [
      undefined,
      {},
      { horario: null },
      { horario: { apertura: '8', cierre: 20 } },
      { horario: { apertura: 20, cierre: 8 } },
      { horario: { 0: { apertura: 450, cierre: 930 } } },
      { horario: { 0: { apertura: 450, cierre: 930 }, 1: null } },
      { horario: { 0: { apertura: 435, cierre: 930 }, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null } },
    ]
    for (const sede of corruptos) {
      const semana = horarioDeSede(sede)
      for (const diaSemana of [0, 1, 2, 3, 4, 5, 6]) {
        assert.deepEqual(semana[diaSemana], { apertura: 420, cierre: 1380 }, JSON.stringify(sede))
      }
    }
  })

  it('horarioDelDia devuelve la franja del día de la fecha, o null si está cerrado', () => {
    const semana = SEMANA_MEDIA_HORA
    assert.deepEqual(horarioDelDia(LUNES, semana), { apertura: 450, cierre: 930 })
    assert.deepEqual(horarioDelDia(SABADO, semana), { apertura: 480, cierre: 780 })
    assert.equal(horarioDelDia(DOMINGO, semana), null)
    // Una fecha inválida no inventa un día.
    assert.equal(horarioDelDia('2026-02-31', semana), null)
    assert.equal(horarioDelDia(null, semana), null)
  })

  it('una sede con horarios distintos entre semana y fin de semana', () => {
    const semana = horarioDeSede(SEDE_MEDIA_HORA)
    const lunes = horarioDelDia(LUNES, semana)
    const sabado = horarioDelDia(SABADO, semana)
    assert.notDeepEqual(lunes, sabado)
    // El lunes se puede reservar a las 7:30; el sábado, no (abre 8:00).
    assert.ok(opcionesDeInicio(60, lunes).includes('07:30'))
    assert.ok(!opcionesDeInicio(60, sabado).includes('07:30'))
    // El domingo está cerrado: no hay huecos.
    assert.deepEqual(opcionesDeInicio(60, horarioDelDia(DOMINGO, semana)), [])
  })

  it('diaDeFecha usa 0 = lunes … 6 = domingo con la fecha LOCAL', () => {
    assert.equal(diaDeFecha(LUNES), 0)
    assert.equal(diaDeFecha(SABADO), 5)
    assert.equal(diaDeFecha(DOMINGO), 6)
    assert.equal(diaDeFecha('2026-11-13'), 4)
    assert.equal(diaDeFecha('2026-02-31'), null)
    assert.equal(diaDeFecha('15/11/2026'), null)
    assert.equal(diaDeFecha(null), null)
  })

  it('etiquetaDia rotula el día en el mismo orden del modelo', () => {
    assert.equal(etiquetaDia(0), 'Lunes')
    assert.equal(etiquetaDia(5), 'Sábado')
    assert.equal(etiquetaDia(6), 'Domingo')
    assert.equal(etiquetaDia(7), '')
  })

  it('franjaValida acepta solo minutos múltiplos de 30 dentro de 0-1440 con cierre > apertura', () => {
    assert.deepEqual(franjaValida({ apertura: 450, cierre: 930 }), { apertura: 450, cierre: 930 })
    assert.deepEqual(franjaValida({ apertura: 0, cierre: 1440 }), { apertura: 0, cierre: 1440 })
    for (const mala of [
      { apertura: 435, cierre: 930 }, // 7:15
      { apertura: 450, cierre: 945 },
      { apertura: 930, cierre: 930 },
      { apertura: 930, cierre: 450 },
      { apertura: -30, cierre: 930 },
      { apertura: 0, cierre: 1470 },
      { apertura: '450', cierre: 930 },
      null,
    ]) {
      assert.equal(franjaValida(mala), null, JSON.stringify(mala))
    }
  })

  it('formatMinutos muestra las medias horas en 12 h', () => {
    assert.equal(formatMinutos(450), '7:30 AM')
    assert.equal(formatMinutos(930), '3:30 PM')
    assert.equal(formatMinutos(0), '12:00 AM')
    assert.equal(formatMinutos(1440), '12:00 AM')
    assert.equal(formatMinutos(1290), '9:30 PM')
  })
})

describe('formato de hora para mostrar (12 h con AM/PM)', () => {
  it('horas enteras: 0, 7, 12, 13, 23 y 24', () => {
    assert.equal(formatHora12(0), '12:00 AM')
    assert.equal(formatHora12(7), '7:00 AM')
    assert.equal(formatHora12(12), '12:00 PM')
    assert.equal(formatHora12(13), '1:00 PM')
    assert.equal(formatHora12(23), '11:00 PM')
    // 24 h es la medianoche: mismo rótulo que 0, sin cero a la izquierda.
    assert.equal(formatHora12(24), '12:00 AM')
  })

  it('strings "HH:mm" (con o sin cero) y minutos', () => {
    assert.equal(formatHora12('07:30'), '7:30 AM')
    assert.equal(formatHora12('19:00'), '7:00 PM')
    assert.equal(formatHora12('00:00'), '12:00 AM')
    assert.equal(formatHora12('12:05'), '12:05 PM')
    assert.equal(formatHora12('23:59'), '11:59 PM')
    assert.equal(formatHora12('7:05'), '7:05 AM')
  })

  it('un valor no reconocible devuelve el texto original (no rompe el render)', () => {
    assert.equal(formatHora12(null), '')
    assert.equal(formatHora12(''), '')
    assert.equal(formatHora12('n/a'), 'n/a')
    assert.equal(formatHora12(25), '25')
    assert.equal(formatHora12(-1), '-1')
  })
})

describe('fechas locales', () => {
  it('aISO usa las partes locales, no toISOString()', () => {
    // 2026-10-03 21:30 en Caracas (UTC-4) ya es 2026-10-04 en UTC.
    const fecha = new Date(2026, 9, 3, 21, 30, 0)
    assert.equal(aISO(fecha), '2026-10-03')
  })

  it('hoyISO coincide con las partes locales de hoy', () => {
    const ahora = new Date()
    const esperado = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(
      ahora.getDate(),
    ).padStart(2, '0')}`
    assert.equal(hoyISO(), esperado)
  })
})

describe('título de clase', () => {
  it('modalidad derivada del cupo', () => {
    assert.equal(modalidadDeClase({ cupo: 1 }), 'Individual')
    assert.equal(modalidadDeClase({ cupo: 4 }), 'Grupal')
  })

  it('etiqueta de categoría', () => {
    assert.equal(etiquetaCategoria('principiante'), 'Principiante')
    assert.equal(etiquetaCategoria('6a'), '6ta')
    assert.equal(etiquetaCategoria('1a'), '1ra')
    assert.equal(etiquetaCategoria('7a'), '7ma')
    assert.equal(etiquetaCategoria(null), null)
  })

  it('título = "Modalidad · Categoría" y solo modalidad sin categoría', () => {
    assert.equal(tituloClase({ cupo: 4, categoria: '6a' }), 'Grupal · 6ta')
    assert.equal(tituloClase({ cupo: 1, categoria: null }), 'Individual')
  })
})

describe('sin cerrar', () => {
  const base = { estado: 'reservada', fecha: '2026-10-03', horaInicio: '18:00', horaFin: '19:00' }

  it('reservada con fin ya pasado (hora local) → true', () => {
    assert.equal(estaSinCerrar(base, new Date(2026, 9, 3, 20, 0, 0)), true)
  })

  it('reservada que todavía no terminó → false', () => {
    assert.equal(estaSinCerrar(base, new Date(2026, 9, 3, 18, 30, 0)), false)
    assert.equal(estaSinCerrar(base, new Date(2026, 9, 3, 8, 0, 0)), false)
  })

  it('otro día, estado cerrado o sin fecha → false', () => {
    assert.equal(estaSinCerrar(base, new Date(2026, 9, 2, 8, 0, 0)), false)
    assert.equal(estaSinCerrar({ ...base, estado: 'pendiente_cobro' }, new Date(2026, 9, 3, 20, 0, 0)), false)
    assert.equal(estaSinCerrar({ ...base, fecha: null }, new Date(2026, 9, 3, 20, 0, 0)), false)
  })

  it('contarSinCerrar cuenta solo las vencidas', () => {
    const ahora = new Date(2026, 9, 3, 20, 0, 0)
    const clases = [base, { ...base, horaFin: '21:00' }, { ...base, estado: 'cobrada' }]
    assert.equal(contarSinCerrar(clases, ahora), 1)
  })
})

describe('normalizarNombreCancha', () => {
  const casos = [
    // [entrada, nombre normalizado que se guarda]
    ['  Cancha   6 ', 'Cancha 6'],
    ['CANCHA6', 'Cancha 6'],
    ['cancha6', 'Cancha 6'],
    // Caja mezclada: la separación letra + dígito aplica igual y el nombre ya
    // mezclado se respeta (bug reportado a mano: "Cancha6" quedaba pegado).
    ['Cancha6', 'Cancha 6'],
    ['Cancha6A', 'Cancha 6A'],
    ['CANCHA 6', 'Cancha 6'],
    ['cancha 6', 'Cancha 6'],
    ['panorámica', 'Panorámica'],
    ['PANORÁMICA', 'Panorámica'],
    ['cancha de arriba', 'Cancha de Arriba'],
    ['CANCHA DE ARRIBA', 'Cancha de Arriba'],
    ['Cancha 10', 'Cancha 10'],
    // Un token con dígitos y letras se respeta como se escribió; el sufijo de
    // una sola letra tras el número queda en mayúscula ("6a" → "6A").
    ['Cancha 6A', 'Cancha 6A'],
    ['CANCHA 6A', 'Cancha 6A'],
    ['cancha 6a', 'Cancha 6A'],
    ['CANCHA6A', 'Cancha 6A'],
    ['6cancha', '6cancha'],
  ]

  it('recorta, colapsa espacios, separa la letra pegada al dígito y arregla la caja', () => {
    for (const [entrada, esperado] of casos) {
      assert.equal(normalizarNombreCancha(entrada), esperado, `entrada: ${JSON.stringify(entrada)}`)
    }
  })

  it('un dígito seguido de letras NO se separa (solo letra + dígito)', () => {
    assert.equal(normalizarNombreCancha('6cancha'), '6cancha')
    assert.equal(normalizarNombreCancha('Cancha 6A'), 'Cancha 6A')
    assert.equal(normalizarNombreCancha('Cancha6A'), 'Cancha 6A')
  })

  it('descarta los caracteres invisibles ANTES de separar letra y dígito', () => {
    // ZWSP, ZWNJ, ZWJ, word joiner y soft hyphen: pegados desde otro lado se
    // cuelan y el nombre quedaba "Cancha6" (visible) sin el espacio.
    for (const invisible of ['\u200b', '\u200c', '\u200d', '\u2060', '\u00ad']) {
      assert.equal(
        normalizarNombreCancha(`Cancha${invisible}6`),
        'Cancha 6',
        `invisible: ${JSON.stringify(invisible)}`,
      )
    }
    // También se descartan dentro de una palabra, no se vuelven un espacio.
    assert.equal(normalizarNombreCancha('Can\u200bcha'), 'Cancha')
    // La clave de unicidad usa la misma limpieza.
    assert.equal(claveNombreCancha('Cancha\u200b6'), claveNombreCancha('Cancha 6'))
  })

  it('un nombre ya mezclado se respeta tal cual (después de recortar)', () => {
    assert.equal(normalizarNombreCancha('Central Sur'), 'Central Sur')
    assert.equal(normalizarNombreCancha('Cancha VIP'), 'Cancha VIP')
    assert.equal(normalizarNombreCancha('  Central   Sur  '), 'Central Sur')
    assert.equal(normalizarNombreCancha('cancha DE arriba'), 'cancha DE arriba')
  })

  it('vacío o solo espacios → cadena vacía', () => {
    assert.equal(normalizarNombreCancha(''), '')
    assert.equal(normalizarNombreCancha('   '), '')
    assert.equal(normalizarNombreCancha(null), '')
    assert.equal(normalizarNombreCancha(undefined), '')
  })

  it('los acentos no se agregan ni se quitan', () => {
    assert.equal(normalizarNombreCancha('panoramica'), 'Panoramica')
    assert.equal(normalizarNombreCancha('PANORAMICA'), 'Panoramica')
  })
})

describe('claveNombreCancha (unicidad)', () => {
  it('ignora caja, espacios de más, acentos y letras pegadas a dígitos', () => {
    const clave = claveNombreCancha('Cancha 6')
    for (const variante of ['cancha 6', '  CANCHA   6  ', 'CANCHA6', 'cancha6']) {
      assert.equal(claveNombreCancha(variante), clave, `variante: ${JSON.stringify(variante)}`)
    }
    assert.equal(claveNombreCancha('Panorámica'), claveNombreCancha('panoramica'))
  })

  it('nombres distintos dan claves distintas', () => {
    assert.notEqual(claveNombreCancha('Cancha 6'), claveNombreCancha('Cancha 10'))
  })
})

/*
 * Clic en un bloque vacío de la agenda: el hueco sale de la posición del clic
 * (redondeo hacia abajo al bloque de 30 min) y de ahí sale el prellenado de la
 * reserva nueva (cancha + hora, en formato interno de 24 h).
 */
describe('hueco de clic en la grilla', () => {
  const rango = { minutoInicio: 540, minutoFin: 1200 }
  const clic = (minutos) =>
    huecoDeClic({ canchaId: 'c2', minutosDesdeInicioGrilla: minutos, rango })

  it('redondea hacia abajo al bloque de 30 min', () => {
    const cinco = (17 - 9) * 60
    assert.deepEqual(clic(cinco), { canchaId: 'c2', horaInicio: '17:00' })
    assert.deepEqual(clic(cinco + 29), { canchaId: 'c2', horaInicio: '17:00' })
    // El minuto 30 ya es la media hora siguiente.
    assert.deepEqual(clic(cinco + 30), { canchaId: 'c2', horaInicio: '17:30' })
    assert.deepEqual(clic(cinco + 59), { canchaId: 'c2', horaInicio: '17:30' })
    // El minuto 60 ya es la hora siguiente.
    assert.deepEqual(clic(cinco + 60), { canchaId: 'c2', horaInicio: '18:00' })
  })

  it('una fila de media hora resuelve a su media hora, no a la hora anterior', () => {
    // Fila de 17:30 en la grilla que arranca a las 9.
    assert.deepEqual(clic((17 - 9) * 60 + 30), { canchaId: 'c2', horaInicio: '17:30' })
    assert.deepEqual(clic((17 - 9) * 60 + 45), { canchaId: 'c2', horaInicio: '17:30' })
    assert.deepEqual(clic((18 - 9) * 60 - 1), { canchaId: 'c2', horaInicio: '17:30' })
  })

  it('la primera fila es la apertura EXACTA (grilla 7:30-15:30)', () => {
    const rangoMedia = { minutoInicio: 450, minutoFin: 930 }
    assert.deepEqual(
      huecoDeClic({ canchaId: 'c2', minutosDesdeInicioGrilla: 0, rango: rangoMedia }),
      { canchaId: 'c2', horaInicio: '07:30' },
    )
    assert.deepEqual(
      huecoDeClic({ canchaId: 'c2', minutosDesdeInicioGrilla: 30, rango: rangoMedia }),
      { canchaId: 'c2', horaInicio: '08:00' },
    )
  })

  it('primera hora y borde de cierre de la franja 9 AM-8 PM', () => {
    assert.deepEqual(clic(0), { canchaId: 'c2', horaInicio: '09:00' })
    // Última hora que admite una reserva de 1 h en esa franja.
    assert.deepEqual(clic((19 - 9) * 60), { canchaId: 'c2', horaInicio: '19:00' })
    // El borde de cierre no admite clase: no está entre las horas del formulario.
    assert.deepEqual(clic((20 - 9) * 60), { canchaId: 'c2', horaInicio: '20:00' })
    assert.ok(!opcionesDeInicio(60, { apertura: 540, cierre: 1200 }).includes('20:00'))
  })

  it('conserva la cancha del clic', () => {
    const hueco = huecoDeClic({ canchaId: 'c7', minutosDesdeInicioGrilla: 0, rango })
    assert.equal(hueco.canchaId, 'c7')
  })

  it('sin rango o sin minutos válidos no hay hueco', () => {
    assert.equal(huecoDeClic({ canchaId: 'c2', minutosDesdeInicioGrilla: 0, rango: null }), null)
    assert.equal(huecoDeClic({ canchaId: 'c2', minutosDesdeInicioGrilla: null, rango }), null)
  })
})

/*
 * Un hueco del pasado no se reserva. Misma regla que la validación de la capa
 * de datos: el borde exacto (inicio === ahora) SÍ se admite.
 */
describe('hueco reservable (reloj inyectable)', () => {
  const hueco = { canchaId: 'c2', horaInicio: '18:00' }

  it('una hora futura es reservable', () => {
    assert.equal(esHuecoReservable(hueco, '2026-10-03', new Date(2026, 9, 3, 17, 0, 0)), true)
    assert.equal(esHuecoReservable(hueco, '2026-10-04', new Date(2026, 9, 3, 23, 0, 0)), true)
  })

  it('exactamente a la hora del hueco sigue siendo reservable', () => {
    assert.equal(esHuecoReservable(hueco, '2026-10-03', new Date(2026, 9, 3, 18, 0, 0)), true)
  })

  it('un minuto después ya es pasado', () => {
    assert.equal(esHuecoReservable(hueco, '2026-10-03', new Date(2026, 9, 3, 18, 1, 0)), false)
    assert.equal(esHuecoReservable(hueco, '2026-10-03', new Date(2026, 9, 4, 0, 0, 0)), false)
  })

  it('un hueco o una fecha inválidos no son reservables', () => {
    const ahora = new Date(2026, 9, 3, 17, 0, 0)
    assert.equal(esHuecoReservable({ canchaId: 'c2', horaInicio: '25:00' }, '2026-10-03', ahora), false)
    assert.equal(esHuecoReservable(null, '2026-10-03', ahora), false)
    assert.equal(esHuecoReservable(hueco, null, ahora), false)
  })
})

/*
 * "Hueco libre" = ninguna clase NO cancelada de esa cancha ocupa el bloque de
 * 30 min. Una clase cancelada no ocupa la cancha, así que el bloque vuelve a
 * estar libre.
 */
describe('hueco libre (clases que ocupan la cancha)', () => {
  const hueco = { canchaId: 'c2', horaInicio: '18:00' }
  const clase = (extra = {}) => ({
    canchaId: 'c2',
    estado: 'reservada',
    horaInicio: '18:00',
    horaFin: '19:00',
    ...extra,
  })

  it('sin clases, o con clases de otra cancha u otra hora, está libre', () => {
    assert.equal(huecoLibre([], hueco), true)
    assert.equal(huecoLibre(null, hueco), true)
    assert.equal(huecoLibre([clase({ canchaId: 'c3' })], hueco), true)
    assert.equal(huecoLibre([clase({ horaInicio: '19:00', horaFin: '20:00' })], hueco), true)
    assert.equal(huecoLibre([clase({ horaInicio: '16:00', horaFin: '17:00' })], hueco), true)
  })

  it('una clase NO cancelada que ocupa ese bloque lo deja ocupado', () => {
    assert.equal(huecoLibre([clase()], hueco), false)
    // Una clase de 2 h ocupa los cuatro bloques de 30 min que toca.
    assert.equal(huecoLibre([clase({ horaInicio: '17:00', horaFin: '19:00' })], hueco), false)
    assert.equal(
      huecoLibre([clase({ horaInicio: '18:00', horaFin: '20:00' })], { ...hueco, horaInicio: '19:30' }),
      false,
    )
  })

  it('un hueco de media hora dentro de una clase está ocupado', () => {
    // 18:30 cae dentro de la clase 18:00-19:00.
    assert.equal(huecoLibre([clase()], { ...hueco, horaInicio: '18:30' }), false)
    // Y una clase que empieza a y media también ocupa el bloque de la hora.
    assert.equal(
      huecoLibre([clase({ horaInicio: '18:30', horaFin: '20:00' })], { ...hueco, horaInicio: '18:30' }),
      false,
    )
    assert.equal(
      huecoLibre([clase({ horaInicio: '18:30', horaFin: '20:00' })], { ...hueco, horaInicio: '19:00' }),
      false,
    )
  })

  it('una clase CANCELADA no ocupa: el bloque queda libre', () => {
    assert.equal(huecoLibre([clase({ estado: 'cancelada' })], hueco), true)
  })

  it('los bloques vecinos de la misma cancha siguen libres', () => {
    assert.equal(huecoLibre([clase()], { ...hueco, horaInicio: '17:00' }), true)
    assert.equal(huecoLibre([clase()], { ...hueco, horaInicio: '17:30' }), true)
    assert.equal(huecoLibre([clase()], { ...hueco, horaInicio: '19:00' }), true)
    assert.equal(huecoLibre([clase()], { ...hueco, horaInicio: '19:30' }), true)
  })

  it('un hueco inválido nunca está libre', () => {
    assert.equal(huecoLibre([], null), false)
    assert.equal(huecoLibre([], { canchaId: 'c2', horaInicio: 'n/a' }), false)
  })
})
