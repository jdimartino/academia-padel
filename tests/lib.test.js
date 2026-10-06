/*
 * Pruebas de helpers puros (sin Firestore ni emulador).
 *
 *   npm run test:lib
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  contarSinCerrar,
  estaSinCerrar,
  etiquetaCategoria,
  formatHora12,
  modalidadDeClase,
  opcionesDeInicio,
  rangoHorasAgenda,
  tituloClase,
} from '../src/lib/agenda.js'
import { aISO, hoyISO } from '../src/lib/fechas.js'
// Helpers puros de db.js: no tocan Firestore, así que se prueban acá sin emulador.
import { claveNombreCancha, normalizarNombreCancha } from '../src/firebase/db.js'

describe('horas de inicio de una reserva', () => {
  it('solo horas en punto, de 07:00 a 23:00 según la duración', () => {
    const unaHora = opcionesDeInicio(60)
    const dosHoras = opcionesDeInicio(120)

    assert.equal(unaHora[0], '07:00')
    assert.equal(dosHoras[0], '07:00')
    // Última hora de inicio: 22:00 con 1 h y 21:00 con 2 h (cierre 23:00).
    assert.equal(unaHora[unaHora.length - 1], '22:00')
    assert.equal(dosHoras[dosHoras.length - 1], '21:00')
    // Solo en punto: todos los valores terminan en ":00".
    assert.ok(unaHora.every((hora) => hora.endsWith(':00')))
    assert.ok(dosHoras.every((hora) => hora.endsWith(':00')))
    // Ni 21:30 ni 22:00 con 2 h.
    assert.ok(!unaHora.includes('21:30'))
    assert.ok(!dosHoras.includes('22:00'))
  })

  it('sin duración válida no ofrece ninguna hora', () => {
    assert.deepEqual(opcionesDeInicio(0), [])
    assert.deepEqual(opcionesDeInicio(-60), [])
  })

  it('con el horario de la sede, la franja arranca en la apertura y cierra en el cierre', () => {
    const unaHora = opcionesDeInicio(60, { apertura: 9, cierre: 20 })
    assert.equal(unaHora[0], '09:00')
    assert.equal(unaHora[unaHora.length - 1], '19:00')

    const dosHoras = opcionesDeInicio(120, { apertura: 9, cierre: 20 })
    assert.equal(dosHoras[0], '09:00')
    assert.equal(dosHoras[dosHoras.length - 1], '18:00')

    // Cierre 24: el formato HH:mm no expresa las 24:00, así que la última
    // hora de inicio sigue siendo la que termina a las 23:00.
    const hastaMedianoche = opcionesDeInicio(60, { apertura: 0, cierre: 24 })
    assert.equal(hastaMedianoche[0], '00:00')
    assert.equal(hastaMedianoche[hastaMedianoche.length - 1], '22:00')
  })
})

/*
 * Rango vertical de la grilla de la agenda: el horario de la sede (apertura →
 * min(cierre, 23)) extendido para que ninguna clase NO cancelada quede fuera.
 */
describe('rango de horas de la agenda', () => {
  const claseEn = (horaInicio, horaFin, extra = {}) => ({
    estado: 'reservada',
    horaInicio,
    horaFin,
    ...extra,
  })

  it('sin clases, el rango es el de la sede y sin horario cae al default 7-23', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 7, cierre: 23 }, []), {
      horaInicio: 7,
      horaFin: 23,
    })
    assert.deepEqual(rangoHorasAgenda(null, []), { horaInicio: 7, horaFin: 23 })
  })

  it('sigue la apertura y el cierre de la sede (9-20)', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 9, cierre: 20 }, []), {
      horaInicio: 9,
      horaFin: 20,
    })
  })

  it('con cierre 24 el fin efectivo es 23 (la última clase termina a las 23:00)', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 7, cierre: 24 }, []), {
      horaInicio: 7,
      horaFin: 23,
    })
  })

  it('una clase de 21:00 a 22:00 adentro del rango default no lo agranda', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 7, cierre: 23 }, [claseEn('21:00', '22:00')]), {
      horaInicio: 7,
      horaFin: 23,
    })
  })

  it('una clase a las 07:00 con apertura 9 extiende el inicio', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 9, cierre: 20 }, [claseEn('07:00', '08:00')]), {
      horaInicio: 7,
      horaFin: 20,
    })
  })

  it('una clase que termina después del cierre extiende el fin', () => {
    assert.deepEqual(rangoHorasAgenda({ apertura: 9, cierre: 20 }, [claseEn('20:00', '21:00')]), {
      horaInicio: 9,
      horaFin: 21,
    })
  })

  it('una clase cancelada fuera del rango NO lo extiende', () => {
    const canceladas = [
      claseEn('07:00', '08:00', { estado: 'cancelada' }),
      claseEn('21:00', '22:00', { estado: 'cancelada' }),
    ]
    assert.deepEqual(rangoHorasAgenda({ apertura: 9, cierre: 20 }, canceladas), {
      horaInicio: 9,
      horaFin: 20,
    })
  })

  it('horario faltante o corrupto → default 7-23', () => {
    const corruptos = [
      undefined,
      null,
      {},
      { apertura: '9', cierre: 20 },
      { apertura: 20, cierre: 8 },
      { apertura: 7, cierre: 25 },
      { apertura: -1, cierre: 20 },
      7,
      'x',
    ]
    for (const horario of corruptos) {
      assert.deepEqual(
        rangoHorasAgenda(horario, []),
        { horaInicio: 7, horaFin: 23 },
        `horario: ${JSON.stringify(horario)}`,
      )
    }
  })

  it('ignora una clase con horas corruptas (no rompe la grilla)', () => {
    const rotas = [claseEn('25:00', '26:00'), claseEn(null, null), claseEn('20:00', '19:00')]
    assert.deepEqual(rangoHorasAgenda({ apertura: 9, cierre: 20 }, rotas), {
      horaInicio: 9,
      horaFin: 20,
    })
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
