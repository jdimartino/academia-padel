/*
 * Pruebas de la lógica pura de avisos (cola de diálogos, toasts y referencia
 * de errores técnicos). Sin React y sin emulador.
 *
 *   npm run test:lib
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AVISOS_INICIAL,
  DURACION_TOAST,
  MAX_TOASTS,
  avisoDeError,
  cerrarError,
  cerrarToast,
  cerrarVencidos,
  codigoDeError,
  dialogoActual,
  esErrorDeNegocio,
  fechaHoraCaracas,
  formatearReferencia,
  hayCambios,
  hayDialogo,
  mostrarConfirmacion,
  mostrarError,
  mostrarExito,
  toastsVencidos,
} from '../src/lib/avisos.js'

/** Error de negocio como los de db.js (name propio y mensaje en español). */
function errorDeNegocio(mensaje, name = 'ClaseInvalidaError') {
  const error = new Error(mensaje)
  error.name = name
  return error
}

/** FirebaseError típico. */
function errorFirebase(code) {
  const error = new Error(`Firebase: Error (${code}).`)
  error.name = 'FirebaseError'
  error.code = code
  return error
}

describe('cola de diálogos', () => {
  it('muestra uno por vez y deja pasar al siguiente al cerrar', () => {
    let estado = AVISOS_INICIAL
    estado = mostrarError(estado, { mensaje: 'Primero' })
    estado = mostrarError(estado, { mensaje: 'Segundo' })

    assert.equal(estado.dialogos.length, 2)
    assert.equal(dialogoActual(estado).mensaje, 'Primero')
    assert.equal(hayDialogo(estado), true)

    estado = cerrarError(estado)
    assert.equal(dialogoActual(estado).mensaje, 'Segundo')

    estado = cerrarError(estado)
    assert.equal(dialogoActual(estado), null)
    assert.equal(hayDialogo(estado), false)

    // Cerrar sin diálogos no cambia nada.
    assert.equal(cerrarError(estado), estado)
  })

  it('no duplica un diálogo idéntico ya mostrado o en cola', () => {
    let estado = AVISOS_INICIAL
    estado = mostrarError(estado, { mensaje: 'El horario ya está ocupado' })
    estado = mostrarError(estado, { mensaje: 'El horario ya está ocupado' })
    assert.equal(estado.dialogos.length, 1)

    // Mismo texto, pero con otra clave explícita: sí se encola.
    estado = mostrarError(estado, { mensaje: 'El horario ya está ocupado', clave: 'otra' })
    assert.equal(estado.dialogos.length, 2)
  })

  it('ignora un mensaje vacío', () => {
    const estado = mostrarError(AVISOS_INICIAL, { mensaje: '   ' })
    assert.equal(estado, AVISOS_INICIAL)
  })

  it('un error técnico idéntico (misma acción y código) no se duplica', () => {
    let estado = AVISOS_INICIAL
    estado = mostrarError(estado, avisoDeError('guardar-horario', errorFirebase('unavailable')))
    estado = mostrarError(estado, avisoDeError('guardar-horario', errorFirebase('unavailable')))
    assert.equal(estado.dialogos.length, 1)

    // Otra acción o otro código sí son diálogos distintos.
    estado = mostrarError(estado, avisoDeError('crear-cancha', errorFirebase('unavailable')))
    estado = mostrarError(estado, avisoDeError('guardar-horario', errorFirebase('permission-denied')))
    assert.equal(estado.dialogos.length, 3)
    assert.equal(dialogoActual(estado).titulo, 'Revisa esto')
  })

  it('confirmación con botones por defecto y sin duplicar', () => {
    const confirmacion = {
      titulo: '¿Salir sin guardar?',
      mensaje: 'Tienes cambios sin guardar.',
      textoCancelar: 'Seguir editando',
      textoConfirmar: 'Salir sin guardar',
    }
    let estado = mostrarConfirmacion(AVISOS_INICIAL, confirmacion)
    estado = mostrarConfirmacion(estado, confirmacion)

    assert.equal(estado.dialogos.length, 1)
    assert.deepEqual(dialogoActual(estado), {
      tipo: 'confirm',
      titulo: '¿Salir sin guardar?',
      mensaje: 'Tienes cambios sin guardar.',
      textoConfirmar: 'Salir sin guardar',
      textoCancelar: 'Seguir editando',
      tecnico: false,
      referencia: null,
      clave: 'confirm:Tienes cambios sin guardar.',
    })
  })
})

describe('toasts de éxito', () => {
  it('cada toast tiene id propio, duración y se van apilando', () => {
    let estado = mostrarExito(AVISOS_INICIAL, 'Cancha 6 agregada', 1000)
    estado = mostrarExito(estado, 'Horario de Traki guardado', 1200)

    assert.equal(estado.toasts.length, 2)
    assert.deepEqual(estado.toasts[0], {
      id: 'toast-1',
      mensaje: 'Cancha 6 agregada',
      creadoEn: 1000,
      duracion: DURACION_TOAST,
    })
    assert.equal(estado.toasts[1].id, 'toast-2')
    assert.equal(DURACION_TOAST, 3500)
  })

  it('como máximo 3 visibles: el más viejo se descarta', () => {
    let estado = AVISOS_INICIAL
    for (let i = 1; i <= 5; i += 1) estado = mostrarExito(estado, `Aviso ${i}`, i * 10)

    assert.equal(estado.toasts.length, MAX_TOASTS)
    assert.deepEqual(
      estado.toasts.map((toast) => toast.mensaje),
      ['Aviso 3', 'Aviso 4', 'Aviso 5'],
    )
  })

  it('se cierra por id y un id desconocido no cambia nada', () => {
    let estado = mostrarExito(AVISOS_INICIAL, 'Clase reservada', 0)
    estado = mostrarExito(estado, 'Clase cancelada', 0)

    const sinCambios = cerrarToast(estado, 'toast-99')
    assert.equal(sinCambios, estado)

    estado = cerrarToast(estado, 'toast-1')
    assert.deepEqual(
      estado.toasts.map((toast) => toast.id),
      ['toast-2'],
    )
  })

  it('auto-cierre a los 3500 ms: ids vencidos y cierre de los vencidos', () => {
    let estado = mostrarExito(AVISOS_INICIAL, 'Alumno guardado', 0)
    estado = mostrarExito(estado, 'Profesor guardado', 3000)

    assert.deepEqual(toastsVencidos(estado, 3499), [])
    assert.deepEqual(toastsVencidos(estado, 3500), ['toast-1'])
    assert.deepEqual(toastsVencidos(estado, 6500), ['toast-1', 'toast-2'])

    const aMitad = cerrarVencidos(estado, 3500)
    assert.deepEqual(
      aMitad.toasts.map((toast) => toast.id),
      ['toast-2'],
    )
    // Nada vencido: mismo estado (no re-render).
    assert.equal(cerrarVencidos(aMitad, 3510), aMitad)
  })

  it('ignora un mensaje vacío y no reutiliza ids', () => {
    let estado = mostrarExito(AVISOS_INICIAL, '')
    assert.equal(estado, AVISOS_INICIAL)

    estado = mostrarExito(estado, 'Primero')
    estado = cerrarToast(estado, 'toast-1')
    estado = mostrarExito(estado, 'Segundo')
    assert.equal(estado.toasts[0].id, 'toast-2')
  })
})

describe('errores de negocio vs técnicos', () => {
  it('reconoce las cuatro clases de db.js por su name', () => {
    for (const name of [
      'SolapamientoError',
      'ClaseInvalidaError',
      'FichaInvalidaError',
      'SedeInvalidaError',
    ]) {
      assert.equal(esErrorDeNegocio(errorDeNegocio('x', name)), true, name)
    }
    assert.equal(esErrorDeNegocio(new TypeError('x')), false)
    assert.equal(esErrorDeNegocio(null), false)
    assert.equal(esErrorDeNegocio('texto'), false)
  })

  it('un error de negocio se muestra tal cual, sin referencia', () => {
    const aviso = avisoDeError('reservar-clase', errorDeNegocio('La cancha ya está ocupada.'))
    assert.deepEqual(aviso, {
      clave: 'error:La cancha ya está ocupada.',
      mensaje: 'La cancha ya está ocupada.',
      tecnico: false,
      referencia: null,
    })
  })

  it('cualquier otra cosa es técnica: mensaje único + referencia', () => {
    const aviso = avisoDeError('guardar-horario', errorFirebase('permission-denied'), new Date(0))
    assert.equal(aviso.tecnico, true)
    assert.equal(aviso.mensaje, 'No se pudo guardar. Inténtalo de nuevo.')
    assert.match(aviso.referencia, /^Referencia: guardar-horario · permission-denied · /)
    assert.equal(aviso.clave, 'tecnico:guardar-horario:permission-denied')
  })

  it('un TypeError, un string lanzado y null también son técnicos', () => {
    for (const error of [new TypeError('boom'), 'boom', null, undefined, { mensaje: 'raro' }]) {
      const aviso = avisoDeError('guardar-alumno', error, new Date(0))
      assert.equal(aviso.tecnico, true)
      assert.equal(aviso.mensaje, 'No se pudo guardar. Inténtalo de nuevo.')
    }
  })
})

describe('código del error', () => {
  it('usa error.code si es string, si no error.name, si no "desconocido"', () => {
    assert.equal(codigoDeError(errorFirebase('unavailable')), 'unavailable')
    assert.equal(codigoDeError({ name: 'FirebaseError' }), 'FirebaseError')
    assert.equal(codigoDeError(new TypeError('x')), 'TypeError')
    assert.equal(codigoDeError(new Error('x')), 'Error')
    assert.equal(codigoDeError({ code: 42, name: 'TypeError' }), 'TypeError')
    assert.equal(codigoDeError('boom'), 'desconocido')
    assert.equal(codigoDeError(null), 'desconocido')
    assert.equal(codigoDeError(undefined), 'desconocido')
  })

  it('descarta valores que no parecen un código (emails, rutas, espacios)', () => {
    assert.equal(codigoDeError({ code: 'juan@academia.com' }), 'desconocido')
    assert.equal(codigoDeError({ name: 'academias/sede 1/canchas' }), 'desconocido')
    assert.equal(codigoDeError({ code: '' }), 'desconocido')
    // Los códigos de Auth llevan "/" y sí se admiten.
    assert.equal(codigoDeError({ code: 'auth/invalid-credential' }), 'auth/invalid-credential')
  })
})

describe('formatearReferencia', () => {
  const ahora = new Date('2026-10-06T19:45:00Z') // 3:45 PM en Caracas (UTC-4)

  it('arma "Referencia: accion · codigo · fecha y hora"', () => {
    assert.equal(
      formatearReferencia('guardar-horario', errorFirebase('permission-denied'), ahora),
      'Referencia: guardar-horario · permission-denied · 06/10/2026 3:45 PM',
    )
  })

  it('usa la hora de Caracas (UTC-4 fijo), también cerca de la medianoche', () => {
    // 19:45 UTC del 6/10 es 3:45 PM del 6/10 en Caracas.
    assert.equal(fechaHoraCaracas(ahora), '06/10/2026 3:45 PM')
    // 03:05 UTC del 6/10 todavía es 5/10 en Caracas: 11:05 PM.
    assert.equal(fechaHoraCaracas(new Date('2026-10-06T03:05:00Z')), '05/10/2026 11:05 PM')
    // Medianoche de Caracas → 12:xx AM (sin cero a la izquierda en la hora).
    assert.equal(fechaHoraCaracas(new Date('2026-10-06T04:00:00Z')), '06/10/2026 12:00 AM')
    assert.equal(fechaHoraCaracas(new Date('2026-01-01T12:05:00Z')), '01/01/2026 8:05 AM')
  })

  it('un error sin código, un string o null quedan como "desconocido"', () => {
    assert.equal(
      formatearReferencia('iniciar-sesion', 'boom', ahora),
      'Referencia: iniciar-sesion · desconocido · 06/10/2026 3:45 PM',
    )
    assert.equal(
      formatearReferencia('iniciar-sesion', null, ahora),
      'Referencia: iniciar-sesion · desconocido · 06/10/2026 3:45 PM',
    )
  })

  it('nunca deja pasar emails, ids ni rutas por la acción o el código', () => {
    const referencia = formatearReferencia(
      'juan@academia.com',
      { code: 'academias/sede-1/clases/x' },
      ahora,
    )
    assert.equal(referencia.includes('@'), false)
    assert.match(referencia, /^Referencia: accion · academias\/sede-1\/clases\/x · /)
    assert.equal(formatearReferencia('', null, ahora).includes('Referencia: accion ·'), true)
  })
})

describe('cambios sin guardar', () => {
  it('valores iguales no son cambios', () => {
    const formulario = { nombre: 'Ana', apellidos: '', sedes: ['s1', 's2'], activo: true }
    assert.equal(hayCambios(formulario, { ...formulario, sedes: ['s1', 's2'] }), false)
    assert.equal(hayCambios(null, undefined), false)
  })

  it('detecta cambios en campos, arreglos y tipos', () => {
    const inicial = { nombre: 'Ana', alumno: 'a1', cupo: 4, alumnos: ['a1', 'a2'], activo: true }
    assert.equal(hayCambios(inicial, { ...inicial, nombre: 'Ana María' }), true)
    assert.equal(hayCambios(inicial, { ...inicial, activo: false }), true)
    assert.equal(hayCambios(inicial, { ...inicial, alumnos: ['a1'] }), true)
    assert.equal(hayCambios(inicial, { ...inicial, alumnos: ['a1', 'a3'] }), true)
    assert.equal(hayCambios(inicial, { ...inicial, cupo: '4' }), true)
    // Cambiar y volver al valor original no cuenta como cambio.
    assert.equal(hayCambios(inicial, { ...inicial, alumnos: ['a1', 'a2'] }), false)
  })
})
