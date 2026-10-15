/*
 * Pruebas de helpers puros (sin Firestore ni emulador).
 *
 *   npm run test:lib
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CATEGORIAS_GRUPO,
  EJE_HORARIO,
  MARCAS_EJE_HORARIO,
  contarSinCerrar,
  diaDeFecha,
  esHuecoReservable,
  estaSinCerrar,
  etiquetaCategoria,
  etiquetaCategoriaGrupo,
  etiquetaDia,
  etiquetaDuracion,
  formatHora12,
  formatMinutos,
  fraccionEnEje,
  franjaValida,
  horarioDeSede,
  horarioDelDia,
  huecoDeClic,
  huecoLibre,
  lineasDeFranja,
  modalidadDeClase,
  opcionesDeInicio,
  rangoHorasAgenda,
  resumenDiaSede,
  resumenHoy,
  tituloClase,
  tramoEnEje,
} from '../src/lib/agenda.js'
import { aISO, hoyISO } from '../src/lib/fechas.js'
// Helpers puros de db.js: no tocan Firestore, así que se prueban acá sin emulador.
import {
  claveNombreCancha,
  claveRepresentante,
  normalizarNombreCancha,
  sugerirDescuentoHermanos,
} from '../src/firebase/db.js'
import {
  LIMITE_MONTO_CENTS,
  LIMITE_TARIFA_CENTS,
  centsValidos,
  formatearUSD,
  parsearUSD,
} from '../src/lib/dinero.js'
import {
  PARAMETROS_DEFAULT,
  PAGOS_SIN_AVISO,
  PERFILES_COBRO_DEFAULT,
  REPARTOS_AUSENCIA,
  alertaCobroValida,
  calcularCierre,
  consumirCreditos,
  duracionesValidas,
  estadoLote,
  faltaConCreditoValida,
  frecuenciaPlanValida,
  leerParametros,
  lotesUsables,
  loteVencido,
  minutosDisponibles,
  minutosFaltaSinAviso,
  minutosPlanValidos,
  motivoValido,
  modoValido,
  pagoProfesorValido,
  pagoSinAvisoValido,
  perfilPorCupo,
  personasValidas,
  precioMensualidad,
  precioPlanValido,
  previsualizarCreditoAlumno,
  recalcularCobro,
  repartirCents,
  repartoAusenciaValido,
  sugerirPrecioCents,
  vencimientoValido,
} from '../src/lib/cobros.js'
import {
  TASA_TTL_MS,
  construirTasasApi,
  consultarTasasApi,
  esTasaVencida,
  etiquetaFuente,
  formatearBs,
  formatearEur,
  guardarTasasCache,
  leerTasasCache,
  normalizarFechaTasa,
  normalizarTasaRespuesta,
  tasasValidas,
  usdCentsABS,
  usdCentsAEur,
} from '../src/lib/tasas.js'

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

  /*
   * La categoría de GRUPO es un campo aparte del nivel: no cambia `tituloClase`,
   * que sigue siendo "Modalidad · Categoría".
   */
  it('categoría de grupo: etiquetas y lista de valores válidos', () => {
    assert.deepEqual(CATEGORIAS_GRUPO, ['infantil', 'junior', 'adulto'])
    assert.equal(etiquetaCategoriaGrupo('infantil'), 'Infantil')
    assert.equal(etiquetaCategoriaGrupo('junior'), 'Junior')
    assert.equal(etiquetaCategoriaGrupo('adulto'), 'Adulto')
    assert.equal(etiquetaCategoriaGrupo(null), null)
    assert.equal(etiquetaCategoriaGrupo(''), null)
  })

  it('la categoría de grupo no toca el título de la clase', () => {
    assert.equal(tituloClase({ cupo: 4, categoria: '6a', categoriaGrupo: 'infantil' }), 'Grupal · 6ta')
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

/** Compara dos fracciones 0..1 tolerando el error de la división. */
const casi = (actual, esperado) => {
  assert.ok(
    Math.abs(actual - esperado) < 1e-9,
    `se esperaba ${esperado} (±1e-9) y llegó ${actual}`,
  )
}

describe('eje y barra del horario (6 AM a medianoche)', () => {
  it('el eje por defecto va de las 6:00 AM a la medianoche', () => {
    assert.deepEqual(EJE_HORARIO, { inicio: 360, fin: 1440 })
  })

  it('las marcas del eje caen en 0, 1/3, 2/3 y 1', () => {
    assert.deepEqual(
      MARCAS_EJE_HORARIO.map((marca) => marca.etiqueta),
      ['6 AM', '12 PM', '6 PM', '12 AM'],
    )
    assert.deepEqual(
      MARCAS_EJE_HORARIO.map((marca) => marca.minutos),
      [360, 720, 1080, 1440],
    )
    MARCAS_EJE_HORARIO.forEach((marca, i) => {
      casi(fraccionEnEje(marca.minutos), i / 3)
    })
  })

  it('fraccionEnEje recorta a los bordes y rechaza un eje inválido', () => {
    casi(fraccionEnEje(360), 0)
    casi(fraccionEnEje(1440), 1)
    casi(fraccionEnEje(720), 1 / 3)
    // Fuera del eje: se recorta al borde.
    casi(fraccionEnEje(0), 0)
    casi(fraccionEnEje(2000), 1)
    assert.equal(fraccionEnEje('7:30'), null)
    assert.equal(fraccionEnEje(720, { inicio: 1440, fin: 360 }), null)
    assert.equal(fraccionEnEje(720, null), null)
  })

  it('tramoEnEje ubica una franja en fracciones 0..1', () => {
    // 7:30-15:30 dentro del eje 6:00-24:00: arranca en 90/1080 y dura 480/1080.
    const manana = tramoEnEje({ apertura: 450, cierre: 930 })
    casi(manana.izquierda, 90 / 1080)
    casi(manana.ancho, 480 / 1080)
    casi(manana.izquierda + manana.ancho, 570 / 1080)

    // 7:00-23:00, el default de la sede.
    const completo = tramoEnEje({ apertura: 420, cierre: 1380 })
    casi(completo.izquierda, 60 / 1080)
    casi(completo.ancho, 960 / 1080)

    // Cierra a medianoche: la barra llega justo al borde derecho.
    const nocturno = tramoEnEje({ apertura: 1200, cierre: 1440 })
    casi(nocturno.izquierda + nocturno.ancho, 1)
  })

  it('tramoEnEje recorta la franja al eje', () => {
    // Abre a las 5:00 (antes del eje): la barra arranca en el borde izquierdo.
    const madrugada = tramoEnEje({ apertura: 300, cierre: 480 })
    casi(madrugada.izquierda, 0)
    casi(madrugada.ancho, 120 / 1080)
  })

  it('tramoEnEje devuelve null cuando la barra debe ir vacía', () => {
    // Franja inválida (cierre <= apertura) o con minutos fuera de la grilla.
    assert.equal(tramoEnEje({ apertura: 600, cierre: 600 }), null)
    assert.equal(tramoEnEje({ apertura: 600, cierre: 300 }), null)
    assert.equal(tramoEnEje({ apertura: 601, cierre: 900 }), null)
    assert.equal(tramoEnEje(null), null)
    assert.equal(tramoEnEje({ apertura: 450, cierre: 930 }, { inicio: 0, fin: 0 }), null)
    // Totalmente fuera del eje: 0:00-1:00 no toca las 6:00-24:00.
    assert.equal(tramoEnEje({ apertura: 0, cierre: 60 }), null)
  })
})

describe('resumen de una sede ("Hoy ..." y canchas)', () => {
  it('una sede abierta hoy muestra la franja y la cantidad de canchas', () => {
    assert.equal(resumenDiaSede(SEDE_MEDIA_HORA, LUNES), 'Hoy 7:30 AM – 3:30 PM')
    assert.equal(resumenHoy(SEDE_MEDIA_HORA, 5, LUNES), 'Hoy 7:30 AM – 3:30 PM · 5 canchas')
    assert.equal(resumenHoy(SEDE_MEDIA_HORA, [1, 2], LUNES), 'Hoy 7:30 AM – 3:30 PM · 2 canchas')
    assert.equal(resumenHoy(SEDE_MEDIA_HORA, 1, LUNES), 'Hoy 7:30 AM – 3:30 PM · 1 cancha')
  })

  it('un día cerrado dice "Hoy cerrada"', () => {
    assert.equal(resumenDiaSede(SEDE_MEDIA_HORA, DOMINGO), 'Hoy cerrada')
    assert.equal(resumenHoy(SEDE_MEDIA_HORA, 0, DOMINGO), 'Hoy cerrada · 0 canchas')
  })

  it('una sede inactiva se resume solo como "Inactiva"', () => {
    const inactiva = { ...SEDE_MEDIA_HORA, activa: false }
    assert.equal(resumenDiaSede(inactiva, LUNES), 'Inactiva')
    assert.equal(resumenHoy(inactiva, 4, LUNES), 'Inactiva')
  })

  it('una sede que cierra a medianoche muestra las 12:00 AM', () => {
    const sede = { horario: { ...SEMANA_MEDIA_HORA, 0: dia(8, 24) } }
    assert.equal(resumenDiaSede(sede, LUNES), 'Hoy 8:00 AM – 12:00 AM')
  })

  it('una fecha inválida se comporta como día cerrado', () => {
    assert.equal(resumenDiaSede(SEDE_MEDIA_HORA, '2026-02-31'), 'Hoy cerrada')
    assert.equal(resumenDiaSede(SEDE_MEDIA_HORA, ''), 'Hoy cerrada')
  })
})

describe('dinero (centavos de USD)', () => {
  it('formatearUSD arma "$enteros.centavos" y descarta lo inválido', () => {
    assert.equal(formatearUSD(0), '$0.00')
    assert.equal(formatearUSD(4500), '$45.00')
    assert.equal(formatearUSD(4550), '$45.50')
    assert.equal(formatearUSD(5), '$0.05')
    // Negativos, no enteros y basura: cadena vacía (nunca "NaN").
    assert.equal(formatearUSD(-1), '')
    assert.equal(formatearUSD(45.5), '')
    assert.equal(formatearUSD(null), '')
    assert.equal(formatearUSD('45'), '')
  })

  it('parsearUSD acepta formatos en-US y es-VE', () => {
    assert.equal(parsearUSD('45'), 4500)
    assert.equal(parsearUSD('45.5'), 4550)
    assert.equal(parsearUSD('45,50'), 4550)
    assert.equal(parsearUSD('$45.00'), 4500)
    assert.equal(parsearUSD('1.234,56'), 123456)
    assert.equal(parsearUSD('1,234.56'), 123456)
    // Redondeo half-up a centavos.
    assert.equal(parsearUSD('45.555'), 4556)
  })

  it('parsearUSD rechaza lo que no es un monto', () => {
    assert.equal(parsearUSD(''), null)
    assert.equal(parsearUSD('   '), null)
    assert.equal(parsearUSD(null), null)
    assert.equal(parsearUSD(undefined), null)
    assert.equal(parsearUSD('abc'), null)
    assert.equal(parsearUSD('-45'), null)
    assert.equal(parsearUSD('45-50'), null)
  })

  it('centsValidos respeta el tope', () => {
    assert.equal(centsValidos(0), true)
    assert.equal(centsValidos(LIMITE_MONTO_CENTS), true)
    assert.equal(centsValidos(LIMITE_MONTO_CENTS + 1), false)
    assert.equal(centsValidos(-1), false)
    assert.equal(centsValidos(1.5), false)
    assert.equal(centsValidos(100, LIMITE_TARIFA_CENTS), true)
    assert.equal(centsValidos(LIMITE_TARIFA_CENTS + 1, LIMITE_TARIFA_CENTS), false)
  })
})

describe('cobros: perfiles de cobro', () => {
  it('los defaults tienen ids fijos y coherentes', () => {
    const ids = PERFILES_COBRO_DEFAULT.map((perfil) => perfil.id)
    assert.deepEqual(ids, ['individual', 'pareja', 'tres', 'cuatro', 'corporativo', 'especial'])
    // Sin repetidos y todos activos.
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(PERFILES_COBRO_DEFAULT.every((perfil) => perfil.activo === true))
  })

  it('personasValidas acepta 1..4 o null', () => {
    assert.equal(personasValidas(null), true)
    assert.equal(personasValidas(1), true)
    assert.equal(personasValidas(4), true)
    assert.equal(personasValidas(0), false)
    assert.equal(personasValidas(5), false)
    assert.equal(personasValidas(2.5), false)
    assert.equal(personasValidas('2'), false)
  })

  it('modoValido y motivoValido filtran por el enum', () => {
    assert.equal(modoValido('total'), true)
    assert.equal(modoValido('por_persona'), true)
    assert.equal(modoValido('mitad'), false)
    assert.equal(motivoValido(null), true)
    assert.equal(motivoValido(undefined), true)
    assert.equal(motivoValido('descuento'), true)
    assert.equal(motivoValido('porque_si'), false)
  })

  it('perfilPorCupo elige el activo que encaja, por orden', () => {
    const perfiles = [
      { id: 'b', personas: 2, activo: true, orden: 9 },
      { id: 'a', personas: 2, activo: true, orden: 2 },
      { id: 'x', personas: 2, activo: false, orden: 1 },
    ]
    assert.equal(perfilPorCupo(perfiles, 2).id, 'a')
    assert.equal(perfilPorCupo(perfiles, 3), null)
    assert.equal(perfilPorCupo(perfiles, null), null)
    assert.equal(perfilPorCupo(null, 2), null)
  })
})

describe('cobros: precio sugerido', () => {
  it('modo total: tarifa por hora × duración / 60', () => {
    assert.equal(sugerirPrecioCents({ tarifaHoraCents: 4500, duracionMin: 60, modo: 'total' }), 4500)
    assert.equal(sugerirPrecioCents({ tarifaHoraCents: 4500, duracionMin: 90, modo: 'total' }), 6750)
    assert.equal(sugerirPrecioCents({ tarifaHoraCents: 4500, duracionMin: 120, modo: 'total' }), 9000)
  })

  it('modo por_persona multiplica por la cantidad de alumnos', () => {
    assert.equal(
      sugerirPrecioCents({ tarifaHoraCents: 4500, duracionMin: 60, modo: 'por_persona', cantidadAlumnos: 4 }),
      18000,
    )
    // Sin alumnos, el monto por persona es 0 (no hay a quién cobrarle).
    assert.equal(
      sugerirPrecioCents({ tarifaHoraCents: 4500, duracionMin: 60, modo: 'por_persona', cantidadAlumnos: 0 }),
      0,
    )
  })

  it('redondea half-up a centavos', () => {
    // 4000 × 45 / 60 = 3000 exacto; 4500 × 45 / 60 = 3375.
    assert.equal(sugerirPrecioCents({ tarifaHoraCents: 4500, duracionMin: 45, modo: 'total' }), 3375)
    // 100 × 45 / 60 = 75.
    assert.equal(sugerirPrecioCents({ tarifaHoraCents: 100, duracionMin: 45, modo: 'total' }), 75)
    // 1000 × 45 / 60 = 750.
    assert.equal(sugerirPrecioCents({ tarifaHoraCents: 1000, duracionMin: 45, modo: 'total' }), 750)
    // 333 × 45 / 60 = 249.75 → 250.
    assert.equal(sugerirPrecioCents({ tarifaHoraCents: 333, duracionMin: 45, modo: 'total' }), 250)
  })

  it('devuelve null sin tarifa o con duración inválida', () => {
    assert.equal(sugerirPrecioCents({ duracionMin: 60, modo: 'total' }), null)
    assert.equal(sugerirPrecioCents({ tarifaHoraCents: null, duracionMin: 60, modo: 'total' }), null)
    assert.equal(sugerirPrecioCents({ tarifaHoraCents: 4500, duracionMin: 0, modo: 'total' }), null)
    assert.equal(sugerirPrecioCents({}), null)
  })
})

describe('cobros: recalcular al reprogramar', () => {
  const sugerido = {
    perfilCobroId: 'cuatro',
    modo: 'total',
    tarifaHoraCents: 5500,
    montoEstandarCents: 5500,
    montoCents: 5500,
    ajustado: false,
    motivoAjuste: null,
  }

  it('una clase sin ajustar toma la sugerencia nueva', () => {
    const nuevo = recalcularCobro({ ...sugerido, montoCents: 5500 }, sugerido)
    assert.deepEqual(nuevo, sugerido)
  })

  it('una clase ajustada conserva monto y motivo, pero actualiza el estándar', () => {
    const actual = { ...sugerido, montoCents: 3000, ajustado: true, motivoAjuste: 'cortesia' }
    const nuevo = recalcularCobro(actual, { ...sugerido, montoEstandarCents: 7000 })
    assert.equal(nuevo.montoCents, 3000)
    assert.equal(nuevo.ajustado, true)
    assert.equal(nuevo.motivoAjuste, 'cortesia')
    assert.equal(nuevo.montoEstandarCents, 7000)
  })

  it('sin sugerencia devuelve el cobro actual tal cual', () => {
    assert.equal(recalcularCobro(sugerido, null), sugerido)
    assert.equal(recalcularCobro(null, null), null)
  })
})

describe('parámetros de la academia', () => {
  it('los defaults son coherentes', () => {
    assert.equal(PARAMETROS_DEFAULT.avisoAusenciaHoras, 24)
    assert.equal(PARAMETROS_DEFAULT.porcentajeFaltaSinAviso, 50)
    assert.deepEqual(PARAMETROS_DEFAULT.duracionesPermitidas, [60, 90, 120])
    assert.equal(PARAMETROS_DEFAULT.vencimientoCreditoDias, null)
    assert.equal(PARAMETROS_DEFAULT.pagoProfesor.modo, 'por_hora')
    assert.equal(PARAMETROS_DEFAULT.pagoProfesor.montoCents, 1500)
    assert.equal(PARAMETROS_DEFAULT.repartoAusenciaAvisada, 'absorbe_academia')
    assert.equal(PARAMETROS_DEFAULT.pagoProfesorSiTodosFaltanSinAviso, 'completo')
  })

  it('repartoAusenciaValido y pagoSinAvisoValido', () => {
    assert.equal(repartoAusenciaValido('absorbe_academia'), true)
    assert.equal(repartoAusenciaValido('reparte_entre_presentes'), true)
    assert.equal(repartoAusenciaValido('otra'), false)
    assert.equal(pagoSinAvisoValido('completo'), true)
    assert.equal(pagoSinAvisoValido('proporcional_cobrado'), true)
    assert.equal(pagoSinAvisoValido('nada'), true)
    assert.equal(pagoSinAvisoValido('mitad'), false)
  })

  it('pagoProfesorValido, alertaCobroValida y vencimientoValido', () => {
    assert.equal(pagoProfesorValido({ modo: 'por_hora', montoCents: 0 }), true)
    assert.equal(pagoProfesorValido({ modo: 'por_clase', montoCents: 2000 }), true)
    assert.equal(pagoProfesorValido({ modo: 'por_mes', montoCents: 2000 }), false)
    assert.equal(pagoProfesorValido(null), false)
    assert.equal(alertaCobroValida({ dias: 0, referencia: 'clase' }), true)
    assert.equal(alertaCobroValida({ dias: 2, referencia: 'vencimiento' }), true)
    assert.equal(alertaCobroValida({ dias: -1, referencia: 'clase' }), false)
    assert.equal(vencimientoValido(null), true)
    assert.equal(vencimientoValido(30), true)
    assert.equal(vencimientoValido(0), false)
  })

  it('duracionesValidas exige lista no vacía, ascendente y múltiplo de 30', () => {
    assert.equal(duracionesValidas([60, 90, 120]), true)
    assert.equal(duracionesValidas([60]), true)
    assert.equal(duracionesValidas([]), false)
    assert.equal(duracionesValidas([90, 60]), false)
    assert.equal(duracionesValidas([60, 60]), false)
    assert.equal(duracionesValidas([45]), false)
    assert.equal(duracionesValidas([300]), false)
    assert.equal(duracionesValidas(null), false)
  })

  it('leerParametros rellena con defaults ante un documento vacío', () => {
    assert.deepEqual(leerParametros(null), {
      avisoAusenciaHoras: 24,
      porcentajeFaltaSinAviso: 50,
      pagoProfesor: { modo: 'por_hora', montoCents: 1500 },
      descuentoHermanosPct: 10,
      duracionesPermitidas: [60, 90, 120],
      vencimientoCreditoDias: null,
      alertaCobro: { dias: 2, referencia: 'clase' },
      restringirCategoriaPorFranja: false,
      repartoAusenciaAvisada: 'absorbe_academia',
      pagoProfesorSiTodosFaltanSinAviso: 'completo',
      faltaSinAvisoConCredito: 'descuenta_completo',
      creditoRequierePago: true,
    })
  })

  it('leerParametros respeta los valores válidos y corrige los corruptos', () => {
    const leidos = leerParametros({
      avisoAusenciaHoras: 12,
      porcentajeFaltaSinAviso: 999, // fuera de rango → default
      pagoProfesor: { modo: 'por_clase', montoCents: 2500 },
      descuentoHermanosPct: 0,
      duracionesPermitidas: [60, 120], // válida
      vencimientoCreditoDias: 45,
      alertaCobro: { dias: 1, referencia: 'vencimiento' },
      restringirCategoriaPorFranja: true,
    })
    assert.equal(leidos.avisoAusenciaHoras, 12)
    assert.equal(leidos.porcentajeFaltaSinAviso, 50)
    assert.deepEqual(leidos.pagoProfesor, { modo: 'por_clase', montoCents: 2500 })
    assert.equal(leidos.descuentoHermanosPct, 0)
    assert.deepEqual(leidos.duracionesPermitidas, [60, 120])
    assert.equal(leidos.vencimientoCreditoDias, 45)
    assert.deepEqual(leidos.alertaCobro, { dias: 1, referencia: 'vencimiento' })
    assert.equal(leidos.restringirCategoriaPorFranja, true)
  })
})

/* ------------------------------------------------------------------ */
/* calcularCierre (Phase 4)                                            */
/* ------------------------------------------------------------------ */

describe('cierre de clase: cálculo de cargos y pago al profesor', () => {
  const PARAMS = { ...PARAMETROS_DEFAULT }

  const cobroTotal = (montoCents = 5000, extra = {}) => ({
    perfilCobroId: 'pareja',
    modo: 'total',
    tarifaHoraCents: 5000,
    montoEstandarCents: 5000,
    montoCents,
    ajustado: false,
    motivoAjuste: null,
    ...extra,
  })

  const cobroPorPersona = (extra = {}) => ({
    perfilCobroId: 'individual',
    modo: 'por_persona',
    tarifaHoraCents: 5000,
    montoEstandarCents: 5000,
    montoCents: 5000,
    ajustado: false,
    motivoAjuste: null,
    ...extra,
  })

  const asis = (...estados) => estados.map((estado, i) => ({ alumnoId: `a${i + 1}`, estado }))

  it('repartirCents reparte y manda el resto a los primeros', () => {
    assert.deepEqual(repartirCents(10000, 3), [3334, 3333, 3333])
    assert.deepEqual(repartirCents(100, 4), [25, 25, 25, 25])
    assert.deepEqual(repartirCents(10, 4), [3, 3, 2, 2])
    assert.deepEqual(repartirCents(0, 3), [0, 0, 0])
    assert.deepEqual(repartirCents(100, 0), [])
  })

  it('modo total con todos presentes: reparto igual y pago completo', () => {
    const { cargos, pagoProfesor, resumen } = calcularCierre({
      cobro: cobroTotal(5000),
      duracionMin: 60,
      asistencias: asis('presente', 'presente'),
      parametros: PARAMS,
    })
    assert.deepEqual(cargos, [
      { alumnoId: 'a1', concepto: 'clase', montoCents: 2500 },
      { alumnoId: 'a2', concepto: 'clase', montoCents: 2500 },
    ])
    assert.deepEqual(pagoProfesor, { montoCents: 1500, base: 1500 })
    assert.equal(resumen.totalCargosCents, 5000)
  })

  it('modo por_persona sin ajustar: recalcula por alumno con la duración real', () => {
    const { cargos, pagoProfesor } = calcularCierre({
      cobro: cobroPorPersona(),
      duracionMin: 90,
      asistencias: asis('presente', 'presente'),
      parametros: PARAMS,
    })
    // 5000 × 90/60 = 7500 por alumno.
    assert.deepEqual(cargos, [
      { alumnoId: 'a1', concepto: 'clase', montoCents: 7500 },
      { alumnoId: 'a2', concepto: 'clase', montoCents: 7500 },
    ])
    // Pago por hora: 1500 × 90/60 = 2250.
    assert.deepEqual(pagoProfesor, { montoCents: 2250, base: 2250 })
  })

  it('modo por_persona AJUSTADO: el monto es el total y se reparte igual', () => {
    const { cargos } = calcularCierre({
      cobro: cobroPorPersona({ montoCents: 9000, ajustado: true, motivoAjuste: 'acuerdo' }),
      duracionMin: 60,
      asistencias: asis('presente', 'presente'),
      parametros: PARAMS,
    })
    assert.deepEqual(cargos, [
      { alumnoId: 'a1', concepto: 'clase', montoCents: 4500 },
      { alumnoId: 'a2', concepto: 'clase', montoCents: 4500 },
    ])
  })

  it('pareja con una avisada: la academia absorbe (default)', () => {
    const { cargos } = calcularCierre({
      cobro: cobroTotal(5000),
      duracionMin: 60,
      asistencias: asis('presente', 'ausente_avisada'),
      parametros: PARAMS,
    })
    assert.deepEqual(cargos, [{ alumnoId: 'a1', concepto: 'clase', montoCents: 2500 }])
  })

  it('pareja con una avisada: reparto entre presentes', () => {
    const { cargos } = calcularCierre({
      cobro: cobroTotal(5000),
      duracionMin: 60,
      asistencias: asis('presente', 'ausente_avisada'),
      parametros: { ...PARAMS, repartoAusenciaAvisada: 'reparte_entre_presentes' },
    })
    assert.deepEqual(cargos, [{ alumnoId: 'a1', concepto: 'clase', montoCents: 5000 }])
  })

  it('falta sin aviso: cobra el porcentaje de la parte', () => {
    const { cargos } = calcularCierre({
      cobro: cobroTotal(5000),
      duracionMin: 60,
      asistencias: asis('presente', 'ausente_sin_aviso'),
      parametros: PARAMS,
    })
    assert.deepEqual(cargos, [
      { alumnoId: 'a1', concepto: 'clase', montoCents: 2500 },
      { alumnoId: 'a2', concepto: 'falta_sin_aviso', montoCents: 1250 },
    ])
  })

  it('todos avisaron: sin cargos y sin pago al profesor', () => {
    const { cargos, pagoProfesor } = calcularCierre({
      cobro: cobroTotal(5000),
      duracionMin: 60,
      asistencias: asis('ausente_avisada', 'ausente_avisada'),
      parametros: PARAMS,
    })
    assert.deepEqual(cargos, [])
    assert.deepEqual(pagoProfesor, { montoCents: 0, base: 1500 })
  })

  it('todos sin aviso: pago según el parámetro', () => {
    const base = {
      cobro: cobroTotal(2000),
      duracionMin: 60,
      asistencias: asis('ausente_sin_aviso', 'ausente_sin_aviso'),
    }
    // 2000 / 2 = 1000; 50% = 500 cada uno → total cobrado 1000.
    const completo = calcularCierre({ ...base, parametros: PARAMS })
    assert.deepEqual(completo.cargos, [
      { alumnoId: 'a1', concepto: 'falta_sin_aviso', montoCents: 500 },
      { alumnoId: 'a2', concepto: 'falta_sin_aviso', montoCents: 500 },
    ])
    assert.deepEqual(completo.pagoProfesor, { montoCents: 1500, base: 1500 })

    const proporcional = calcularCierre({
      ...base,
      parametros: { ...PARAMS, pagoProfesorSiTodosFaltanSinAviso: 'proporcional_cobrado' },
    })
    assert.deepEqual(proporcional.pagoProfesor, { montoCents: 1000, base: 1500 })

    const nada = calcularCierre({
      ...base,
      parametros: { ...PARAMS, pagoProfesorSiTodosFaltanSinAviso: 'nada' },
    })
    assert.deepEqual(nada.pagoProfesor, { montoCents: 0, base: 1500 })
  })

  it('seFactura false: ni cargos ni pago', () => {
    const { cargos, pagoProfesor } = calcularCierre({
      cobro: cobroTotal(5000),
      duracionMin: 60,
      asistencias: asis('presente', 'presente'),
      parametros: PARAMS,
      seFactura: false,
    })
    assert.deepEqual(cargos, [])
    assert.deepEqual(pagoProfesor, { montoCents: 0, base: 1500 })
  })

  it('cortesía: sin cargos pero el profesor cobra si alguien vino', () => {
    const { cargos, pagoProfesor } = calcularCierre({
      cobro: cobroTotal(0, { ajustado: true, motivoAjuste: 'cortesia' }),
      duracionMin: 60,
      asistencias: asis('presente', 'ausente_sin_aviso'),
      parametros: PARAMS,
    })
    assert.deepEqual(cargos, [])
    assert.deepEqual(pagoProfesor, { montoCents: 1500, base: 1500 })
  })

  it('clase sin cobro con monto manual (total ajustado)', () => {
    const { cargos, resumen } = calcularCierre({
      cobro: {
        perfilCobroId: null,
        modo: 'total',
        tarifaHoraCents: null,
        montoEstandarCents: null,
        montoCents: 3000,
        ajustado: true,
        motivoAjuste: 'otro',
      },
      duracionMin: 60,
      asistencias: asis('presente', 'presente'),
      parametros: PARAMS,
    })
    assert.deepEqual(cargos, [
      { alumnoId: 'a1', concepto: 'clase', montoCents: 1500 },
      { alumnoId: 'a2', concepto: 'clase', montoCents: 1500 },
    ])
    assert.equal(resumen.montoClaseCents, 3000)
  })

  it('los centavos del resto van a los primeros alumnos', () => {
    const { cargos } = calcularCierre({
      cobro: cobroTotal(10000),
      duracionMin: 60,
      asistencias: asis('presente', 'presente', 'presente'),
      parametros: PARAMS,
    })
    assert.deepEqual(
      cargos.map((c) => c.montoCents),
      [3334, 3333, 3333],
    )
    assert.equal(
      cargos.reduce((t, c) => t + c.montoCents, 0),
      10000,
    )
  })

  it('el pago por_clase no depende de la duración', () => {
    const { pagoProfesor } = calcularCierre({
      cobro: cobroTotal(5000),
      duracionMin: 120,
      asistencias: asis('presente'),
      parametros: { ...PARAMS, pagoProfesor: { modo: 'por_clase', montoCents: 3000 } },
    })
    assert.deepEqual(pagoProfesor, { montoCents: 3000, base: 3000 })
  })
})

describe('constantes de cierre (Phase 4)', () => {
  it('exporta las listas de enums', () => {
    assert.deepEqual(REPARTOS_AUSENCIA, ['absorbe_academia', 'reparte_entre_presentes'])
    assert.deepEqual(PAGOS_SIN_AVISO, ['completo', 'proporcional_cobrado', 'nada'])
  })
})

/* ------------------------------------------------------------------ */
/* Phase 5: planes, créditos y hermanos                                */
/* ------------------------------------------------------------------ */

describe('parámetros de mensualidades', () => {
  it('los defaults y validadores nuevos', () => {
    assert.equal(PARAMETROS_DEFAULT.faltaSinAvisoConCredito, 'descuenta_completo')
    assert.equal(PARAMETROS_DEFAULT.creditoRequierePago, true)
    assert.equal(faltaConCreditoValida('descuenta_proporcional'), true)
    assert.equal(faltaConCreditoValida('descuenta_completo'), true)
    assert.equal(faltaConCreditoValida('cobra_aparte'), true)
    assert.equal(faltaConCreditoValida('otra'), false)
    assert.equal(frecuenciaPlanValida('mensual'), true)
    assert.equal(frecuenciaPlanValida('semanal'), true)
    assert.equal(frecuenciaPlanValida('diaria'), false)
    assert.equal(minutosPlanValidos(60), true)
    assert.equal(minutosPlanValidos(90), true)
    assert.equal(minutosPlanValidos(0), false)
    assert.equal(minutosPlanValidos(45), false)
    assert.equal(precioPlanValido(4500), true)
    assert.equal(precioPlanValido(0), false)
  })

  it('leerParametros rellena los nuevos y corrige los corruptos', () => {
    const def = leerParametros(null)
    assert.equal(def.faltaSinAvisoConCredito, 'descuenta_completo')
    assert.equal(def.creditoRequierePago, true)
    const leidos = leerParametros({
      faltaSinAvisoConCredito: 'cobra_aparte',
      creditoRequierePago: false,
    })
    assert.equal(leidos.faltaSinAvisoConCredito, 'cobra_aparte')
    assert.equal(leidos.creditoRequierePago, false)
    const corruptos = leerParametros({ faltaSinAvisoConCredito: 'x', creditoRequierePago: 'si' })
    assert.equal(corruptos.faltaSinAvisoConCredito, 'descuenta_completo')
    assert.equal(corruptos.creditoRequierePago, true)
  })
})

describe('créditos: lotes, FIFO, vencimiento y consumo', () => {
  const lote = (id, comprados, usados, extra = {}) => ({
    id,
    minutosComprados: comprados,
    minutosUsados: usados,
    inicio: '2026-01-01',
    venceEn: null,
    ...extra,
  })

  it('minutosDisponibles nunca es negativo', () => {
    assert.equal(minutosDisponibles(lote('a', 60, 20)), 40)
    assert.equal(minutosDisponibles(lote('a', 60, 90)), 0)
    assert.equal(minutosDisponibles(null), 0)
  })

  it('loteVencido compara por fecha (el día de vencimiento todavía sirve)', () => {
    const v = lote('a', 60, 0, { venceEn: '2026-03-10' })
    assert.equal(loteVencido(v, '2026-03-09'), false)
    assert.equal(loteVencido(v, '2026-03-10'), false)
    assert.equal(loteVencido(v, '2026-03-11'), true)
    assert.equal(loteVencido(lote('b', 60, 0), '2030-01-01'), false)
  })

  it('estadoLote: activo, agotado, vencido, anulado y bloqueado', () => {
    assert.equal(estadoLote(lote('a', 60, 0), '2026-01-01'), 'activo')
    assert.equal(estadoLote(lote('a', 60, 60), '2026-01-01'), 'agotado')
    assert.equal(estadoLote(lote('a', 60, 0, { venceEn: '2026-01-01' }), '2026-01-02'), 'vencido')
    assert.equal(estadoLote(lote('a', 60, 0, { estado: 'anulado' }), '2026-01-01'), 'anulado')
    assert.equal(
      estadoLote(lote('a', 60, 0), '2026-01-01', {
        creditoRequierePago: true,
        cargoPagado: false,
      }),
      'bloqueado',
    )
    assert.equal(
      estadoLote(lote('a', 60, 0), '2026-01-01', {
        creditoRequierePago: true,
        cargoPagado: true,
      }),
      'activo',
    )
  })

  it('lotesUsables ordena FIFO por vencimiento (null al final) y después inicio', () => {
    const a = lote('a', 60, 0, { venceEn: '2026-05-01', inicio: '2026-02-01' })
    const b = lote('b', 60, 0, { venceEn: '2026-04-01', inicio: '2026-03-01' })
    const c = lote('c', 60, 0, { venceEn: null, inicio: '2026-01-01' })
    const d = lote('d', 60, 0, { venceEn: null, inicio: '2026-01-02' })
    assert.deepEqual(
      lotesUsables([a, b, c, d], '2026-01-01').map((l) => l.id),
      ['b', 'a', 'c', 'd'],
    )
    assert.deepEqual(lotesUsables([lote('x', 60, 60)], '2026-01-01'), [])
  })

  it('lotesUsables excluye los bloqueados cuando creditoRequierePago', () => {
    const sinPagar = { ...lote('a', 60, 0), cargoPagado: false }
    const pagado = { ...lote('b', 60, 0), cargoPagado: true }
    assert.deepEqual(
      lotesUsables([sinPagar, pagado], '2026-01-01', { creditoRequierePago: true }).map((l) => l.id),
      ['b'],
    )
  })

  it('consumirCreditos usa FIFO y reporta faltante', () => {
    const a = lote('a', 60, 0, { venceEn: '2026-04-01' })
    const b = lote('b', 60, 0, { venceEn: '2026-05-01' })
    const ok = consumirCreditos([a, b], 90)
    assert.deepEqual(ok.asignaciones, [
      { creditoId: 'a', minutos: 60 },
      { creditoId: 'b', minutos: 30 },
    ])
    assert.equal(ok.faltante, 0)
    const falta = consumirCreditos([a], 90)
    assert.equal(falta.faltante, 30)
    assert.equal(consumirCreditos([a], 0).faltante, 0)
  })

  it('minutosFaltaSinAviso: proporcional (half-up), completo y cobra_aparte', () => {
    assert.equal(minutosFaltaSinAviso(60, 50, 'descuenta_proporcional'), 30)
    assert.equal(minutosFaltaSinAviso(90, 50, 'descuenta_proporcional'), 45)
    assert.equal(minutosFaltaSinAviso(60, 33, 'descuenta_proporcional'), 20)
    assert.equal(minutosFaltaSinAviso(60, 50, 'descuenta_completo'), 60)
    assert.equal(minutosFaltaSinAviso(60, 50, 'cobra_aparte'), 0)
  })

  it('precioMensualidad aplica el descuento de hermanos (half-up)', () => {
    assert.equal(precioMensualidad({ precioCents: 10000 }, 10), 10000)
    assert.equal(precioMensualidad({ precioCents: 10000, descuentoHermanos: true }, 10), 9000)
    assert.equal(precioMensualidad({ precioCents: 10000, descuentoHermanos: false }, 10), 10000)
    assert.equal(precioMensualidad({ precioCents: 5000, descuentoHermanos: true }, 10), 4500)
    assert.equal(precioMensualidad({ precioCents: 3333, descuentoHermanos: true }, 10), 3000)
  })

  it('previsualizarCreditoAlumno: presente, falta sin aviso y avisada', () => {
    assert.deepEqual(
      previsualizarCreditoAlumno({ estado: 'presente', minutosClase: 60, minutosDisponibles: 60 }),
      { usaCredito: true, minutos: 60, motivo: 'clase', requiereCargo: false },
    )
    const insuficiente = previsualizarCreditoAlumno({
      estado: 'presente',
      minutosClase: 60,
      minutosDisponibles: 30,
    })
    assert.equal(insuficiente.usaCredito, false)
    assert.equal(insuficiente.requiereCargo, true)
    assert.equal(insuficiente.insuficiente, true)

    const porDefecto = previsualizarCreditoAlumno({
      estado: 'ausente_sin_aviso',
      minutosClase: 60,
      minutosDisponibles: 60,
      porcentajeFaltaSinAviso: 50,
    })
    assert.deepEqual(porDefecto, {
      usaCredito: true,
      minutos: 60,
      motivo: 'falta_sin_aviso',
      requiereCargo: false,
    })

    const proporcional = previsualizarCreditoAlumno({
      estado: 'ausente_sin_aviso',
      minutosClase: 60,
      minutosDisponibles: 30,
      porcentajeFaltaSinAviso: 50,
      faltaSinAvisoConCredito: 'descuenta_proporcional',
    })
    assert.deepEqual(proporcional, {
      usaCredito: true,
      minutos: 30,
      motivo: 'falta_sin_aviso',
      requiereCargo: false,
    })

    const aparte = previsualizarCreditoAlumno({
      estado: 'ausente_sin_aviso',
      minutosClase: 60,
      minutosDisponibles: 600,
      porcentajeFaltaSinAviso: 50,
      faltaSinAvisoConCredito: 'cobra_aparte',
    })
    assert.equal(aparte.usaCredito, false)
    assert.equal(aparte.requiereCargo, true)

    const avisada = previsualizarCreditoAlumno({
      estado: 'ausente_avisada',
      minutosClase: 60,
      minutosDisponibles: 600,
    })
    assert.equal(avisada.usaCredito, false)
    assert.equal(avisada.requiereCargo, false)
  })
})

describe('hermanos: clave del representante y sugerencia', () => {
  it('claveRepresentante normaliza nombre (sin tildes ni mayúsculas) y teléfono', () => {
    assert.equal(
      claveRepresentante({ nombre: 'Ávila', apellidos: 'Ñáñez', telefono: '+58 414-111-2222' }),
      claveRepresentante({ nombre: 'avila', apellidos: 'nanez', telefono: '584141112222' }),
    )
    assert.equal(claveRepresentante(null), null)
    assert.equal(claveRepresentante({}), null)
  })

  it('sugerirDescuentoHermanos: solo menores activos con el mismo representante', () => {
    const rep = { nombre: 'Teresa', apellidos: 'Ríos', telefono: '+58 414 111 2222' }
    const menor = { id: 'a2', tipo: 'menor', activo: true, representante: rep }
    const hermano = { id: 'a12', tipo: 'menor', activo: true, representante: { ...rep, nombre: 'teresa' } }
    const adulto = { id: 'a1', tipo: 'adulto', activo: true, representante: null }
    assert.equal(sugerirDescuentoHermanos(menor, [menor, hermano]), true)
    assert.equal(sugerirDescuentoHermanos(menor, [menor, adulto]), false)
    assert.equal(sugerirDescuentoHermanos(adulto, [menor]), false)
    assert.equal(sugerirDescuentoHermanos(menor, [menor, { ...hermano, activo: false }]), false)
    assert.equal(sugerirDescuentoHermanos(menor, [menor]), false)
  })
})

/* ------------------------------------------------------------------ */
/* Fase 6: tasas BCV (dólar y euro)                                    */
/* ------------------------------------------------------------------ */

describe('tasas BCV: parseo, conversión, formato, vencimiento y caché', () => {
  const USD = { moneda: 'USD', fuente: 'oficial', promedio: 879.1225, fechaActualizacion: '2026-10-15T00:00:00-04:00' }
  const EUR = { moneda: 'EUR', fuente: 'oficial', promedio: 977.68092347, fechaActualizacion: '2026-10-15T00:00:00-04:00' }

  it('normaliza fechas y el valor de la respuesta (promedio/venta/compra)', () => {
    assert.equal(normalizarFechaTasa('2026-10-15T00:00:00-04:00'), '2026-10-15')
    assert.equal(normalizarFechaTasa('2026-10-15'), '2026-10-15')
    assert.equal(normalizarFechaTasa(new Date('2026-10-15T12:00:00Z')), '2026-10-15')
    assert.equal(normalizarFechaTasa('no-es-fecha'), null)
    assert.equal(normalizarFechaTasa(null), null)

    assert.equal(normalizarTasaRespuesta(USD), 879.1225)
    assert.equal(normalizarTasaRespuesta({ venta: 10.5, promedio: null }), 10.5)
    assert.equal(normalizarTasaRespuesta({ compra: 9 }), 9)
    assert.equal(normalizarTasaRespuesta({ promedio: -1 }), null)
    assert.equal(normalizarTasaRespuesta({}), null)
    assert.equal(normalizarTasaRespuesta(null), null)
  })

  it('construye las tasas de la API y exige las dos monedas', () => {
    const ahora = new Date('2026-10-15T13:00:00Z')
    const tasas = construirTasasApi(USD, EUR, ahora)
    assert.equal(tasas.bsPorUsd, 879.1225)
    assert.equal(tasas.bsPorEur, 977.68092347)
    assert.equal(tasas.fecha, '2026-10-15')
    assert.equal(tasas.fuente, 'api')
    assert.equal(tasas.obtenidoEn, ahora.getTime())
    assert.equal(construirTasasApi(USD, { moneda: 'EUR' }, ahora), null)
    assert.equal(construirTasasApi(null, EUR, ahora), null)
    assert.equal(tasasValidas(tasas), true)
    assert.equal(tasasValidas({ bsPorUsd: 0, bsPorEur: 1 }), false)
    assert.equal(tasasValidas(null), false)
  })

  it('consulta la API con un fetch INYECTADO (sin red) y tolera fallas', async () => {
    const ok = (cuerpo) => async () => ({ ok: true, json: async () => cuerpo })
    const tasas = await consultarTasasApi((url) => ok(url.includes('euros') ? EUR : USD)())
    assert.equal(tasas.bsPorUsd, 879.1225)
    assert.equal(tasas.bsPorEur, 977.68092347)

    const falla = await consultarTasasApi(async () => {
      throw new Error('sin red')
    })
    assert.equal(falla, null)
    const noOk = await consultarTasasApi(async () => ({ ok: false, json: async () => ({}) }))
    assert.equal(noOk, null)
    assert.equal(await consultarTasasApi(undefined), null)
  })

  it('convierte centavos de USD a Bs y EUR', () => {
    assert.ok(Math.abs(usdCentsABS(1000, 879.1225) - 8791.225) < 1e-9)
    assert.equal(usdCentsABS(0, 879), 0)
    assert.equal(usdCentsABS(1000, 0), null)
    assert.equal(usdCentsABS(-1, 879), null)
    // 10 USD = 8.791,225 Bs; EUR = Bs / 977.68.
    const eur = usdCentsAEur(1000, 879.1225, 977.68092347)
    assert.ok(Math.abs(eur - 8.9918) < 0.001)
    assert.equal(usdCentsAEur(1000, 879, 0), null)
  })

  it('formatea en es-VE y etiqueta la fuente', () => {
    assert.equal(formatearBs(8791.225), 'Bs 8.791,23')
    assert.equal(formatearEur(8.9918), '€ 8,99')
    assert.equal(formatearBs(Number.NaN), '')
    assert.equal(etiquetaFuente('api'), 'API BCV')
    assert.equal(etiquetaFuente('manual'), 'Manual')
    assert.equal(etiquetaFuente(null), 'Sin tasa')
  })

  it('detecta la tasa desactualizada', () => {
    const base = Date.parse('2026-10-15T12:00:00')
    const fresca = { bsPorUsd: 1, bsPorEur: 1, fuente: 'api', obtenidoEn: base }
    assert.equal(esTasaVencida(fresca, base + 60 * 60 * 1000), false)
    assert.equal(esTasaVencida(fresca, base + 25 * 60 * 60 * 1000), true)
    assert.equal(esTasaVencida(null, base), true)
    const manual = { bsPorUsd: 1, bsPorEur: 1, fuente: 'manual', fecha: '2026-10-10' }
    assert.equal(esTasaVencida(manual, Date.parse('2026-10-11T00:00:00')), false)
  })

  it('lee y escribe el caché con storage inyectado y TTL', () => {
    const mapa = new Map()
    const storage = {
      getItem: (clave) => (mapa.has(clave) ? mapa.get(clave) : null),
      setItem: (clave, valor) => mapa.set(clave, valor),
    }
    const ahora = Date.parse('2026-10-15T12:00:00')
    const tasas = { bsPorUsd: 879.12, bsPorEur: 977.68, fecha: '2026-10-15', fuente: 'api' }
    assert.equal(guardarTasasCache(storage, tasas, ahora), true)
    const leidas = leerTasasCache(storage, ahora + 30 * 60 * 1000, TASA_TTL_MS)
    assert.equal(leidas.bsPorUsd, 879.12)
    assert.equal(leidas.guardadoEn, ahora)
    // Pasado el TTL devuelve null, salvo que se pida con TTL infinito.
    assert.equal(leerTasasCache(storage, ahora + 2 * TASA_TTL_MS, TASA_TTL_MS), null)
    assert.equal(leerTasasCache(storage, ahora + 2 * TASA_TTL_MS, Number.POSITIVE_INFINITY).bsPorEur, 977.68)
    // Storage roto o vacío nunca rompe.
    assert.equal(leerTasasCache(null, ahora), null)
    assert.equal(guardarTasasCache(null, tasas), false)
    assert.equal(leerTasasCache({ getItem: () => '{{' }), null)
  })
})
