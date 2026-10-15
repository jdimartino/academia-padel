import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { anularCierre, asignarAlumnos, cancelarClase, getCierreDeClase } from '../firebase/db'
import useAccion from '../hooks/useAccion'
import useCierreSeguro from '../hooks/useCierreSeguro'
import BotonAccion from './BotonAccion'
import CerrarClase from './CerrarClase'
import { CloseIcon } from './Icons'
import { estadoDe, etiquetaCategoriaGrupo, formatHora12, tituloClase } from '../lib/agenda'
import { formatearUSD } from '../lib/dinero'
import { formatearFechaLarga } from '../lib/fechas'
import SelectorAlumnos from './SelectorAlumnos'

const ESTADOS_CERRADOS = ['pendiente_cobro', 'cobrada', 'cancelada']

/** Estados que tienen cierre (cargos / pago / movimientos de crédito). */
const ESTADOS_CON_CIERRE = ['pendiente_cobro', 'cobrada']

/** Etiquetas de los movimientos de crédito de un cierre. */
const MOTIVOS_MOVIMIENTO_LABEL = {
  clase: 'Crédito de la clase',
  falta_sin_aviso: 'Crédito por falta sin aviso',
}

/** Etiquetas de los motivos de ajuste del precio de una clase. */
const MOTIVOS_AJUSTE_LABEL = {
  descuento: 'Descuento',
  cortesia: 'Cortesía',
  acuerdo: 'Acuerdo',
  otro: 'Ajustado',
}

const CONCEPTOS_CARGO_LABEL = {
  clase: 'Clase',
  falta_sin_aviso: 'Falta sin aviso',
  mensualidad: 'Mensualidad',
  otro: 'Otro',
}

const ESTADO_COBRO_LABEL = {
  pendiente: 'Pendiente',
  pagado: 'Pagado',
  anulado: 'Anulado',
}

/** Empareja IDs de alumnos con sus nombres denormalizados. */
function alumnosDeClase(clase) {
  const ids = clase.alumnos ?? []
  const nombres = clase.alumnoNombres ?? []
  return ids.map((id, i) => ({ id, nombre: nombres[i] ?? 'Alumno' }))
}

export default function DetailSheet({
  clase,
  canchas,
  clases = [],
  sedeNombre,
  tenantId,
  rol,
  parametros = null,
  onClose,
  onChanged,
  onReprogramar,
}) {
  const { user } = useAuth()
  const estado = estadoDe(clase.estado)
  const cancha = canchas.find((c) => c.id === clase.canchaId)
  const cupo = clase.cupo ?? 0
  const alumnos = alumnosDeClase(clase)
  const nombrePorAlumno = Object.fromEntries(alumnos.map((a) => [a.id, a.nombre]))

  const esAdmin = rol === 'administrador'
  // El administrador cierra la clase (asistencia + cobro). Profesor, alumno y
  // representante son fichas sin acceso.
  const puedeCerrar = esAdmin && clase.estado === 'reservada'
  const puedeCancelar = esAdmin && !ESTADOS_CERRADOS.includes(clase.estado)
  const puedeReprogramar = esAdmin && clase.estado === 'reservada'
  // La asignación de alumnos solo se permite en una clase `reservada`.
  const puedeAsignar = esAdmin && clase.estado === 'reservada'

  const [confirmando, setConfirmando] = useState(false)
  const [cierre, setCierre] = useState(null)
  const [anulando, setAnulando] = useState(false)
  const accionAlumnos = useAccion()

  const recargarCierre = useCallback(() => {
    getCierreDeClase(db, tenantId, clase.id)
      .then((data) => setCierre(data))
      .catch(() => setCierre(null))
  }, [tenantId, clase.id])

  // Al abrir una clase CERRADA se leen sus cargos, su pago y sus créditos.
  useEffect(() => {
    if (ESTADOS_CON_CIERRE.includes(clase.estado)) recargarCierre()
  }, [clase.estado, recargarCierre])

  useCierreSeguro({
    sucio: false,
    onCerrar: onClose,
    interceptar: () => {
      if (!confirmando) return false
      setConfirmando(false)
      return true
    },
  })

  function cambiarAlumnos(nueva) {
    accionAlumnos.ejecutar(
      () =>
        asignarAlumnos(db, tenantId, clase.id, nueva.map((alumno) => alumno.id), {
          uid: user?.uid ?? null,
        }),
      { accion: 'asignar-alumnos', alExito: () => onChanged?.() },
    )
  }

  function alCerrar() {
    recargarCierre()
    onChanged?.()
  }

  function anular() {
    setAnulando(false)
    return anularCierre(db, tenantId, clase.id, { uid: user?.uid ?? null })
  }

  function cancelar() {
    return cancelarClase(db, tenantId, clase.id, { uid: user?.uid ?? null })
  }

  const conCierre = ESTADOS_CON_CIERRE.includes(clase.estado)
  const cargos = conCierre ? (cierre?.cargos ?? []) : []
  const pago = conCierre ? (cierre?.pagoProfesor ?? null) : null
  const movimientos = conCierre ? (cierre?.movimientos ?? []).filter((m) => m.minutos > 0) : []
  const algoPagado = cargos.some((c) => c.estado === 'pagado') || pago?.estado === 'pagado'

  return (
    <aside className="sheet glass-strong" role="dialog" aria-label="Detalle de la clase">
      <header className="sheet__head">
        <span className={`badge badge--${estado.tono}`}>{estado.label.toUpperCase()}</span>
        <button type="button" className="icon-btn" aria-label="Cerrar detalle" onClick={onClose} autoFocus>
          <CloseIcon />
        </button>
      </header>

      <h2 className="sheet__titulo">{tituloClase(clase)}</h2>

      <dl className="sheet__datos">
        <div className="sheet__fila">
          <dt>Sede</dt>
          <dd>{clase.sedeNombre ?? sedeNombre}</dd>
        </div>
        <div className="sheet__fila">
          <dt>Cancha</dt>
          <dd>{cancha?.nombre ?? clase.canchaNombre ?? 'Cancha'}</dd>
        </div>
        <div className="sheet__fila">
          <dt>Fecha</dt>
          <dd>{formatearFechaLarga(clase.fecha)}</dd>
        </div>
        <div className="sheet__fila">
          <dt>Horario</dt>
          <dd>
            {formatHora12(clase.horaInicio)} - {formatHora12(clase.horaFin)}
          </dd>
        </div>
        <div className="sheet__fila">
          <dt>Profesor</dt>
          <dd>{clase.profesorNombre}</dd>
        </div>
        {clase.asistenciaProfesor ? (
          <div className="sheet__fila">
            <dt>Asistencia</dt>
            <dd>Confirmada por el profesor</dd>
          </div>
        ) : null}
        {clase.categoriaGrupo ? (
          <div className="sheet__fila">
            <dt>Categoría de grupo</dt>
            <dd>{etiquetaCategoriaGrupo(clase.categoriaGrupo)}</dd>
          </div>
        ) : null}
        <div className="sheet__fila">
          <dt>Alumnos</dt>
          <dd>
            {alumnos.length} de {cupo}
          </dd>
        </div>
        {clase.cobro ? (
          <div className="sheet__fila">
            <dt>Precio</dt>
            <dd>
              {formatearUSD(clase.cobro.montoCents)}
              {clase.cobro.ajustado ? (
                <span className="badge badge--ajuste">
                  {MOTIVOS_AJUSTE_LABEL[clase.cobro.motivoAjuste] ?? 'Ajustado'}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      {puedeAsignar ? (
        <div className="sheet__slots">
          <h3 className="sheet__subtitulo">Alumnos</h3>
          <SelectorAlumnos
            tenantId={tenantId}
            cupo={cupo}
            seleccionados={alumnos}
            onChange={cambiarAlumnos}
            clases={clases}
            claseId={clase.id}
            horaInicio={clase.horaInicio}
            horaFin={clase.horaFin}
          />
          {accionAlumnos.visible ? <p className="aviso">Guardando alumnos…</p> : null}
        </div>
      ) : alumnos.length ? (
        <div className="sheet__slots">
          <h3 className="sheet__subtitulo">Alumnos</h3>
          <ul className="chips-sel">
            {alumnos.map((alumno) => (
              <li key={alumno.id}>
                <span className="chip-sel--fijo">{alumno.nombre}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {puedeCerrar && alumnos.length ? (
        <CerrarClase
          clase={clase}
          parametros={parametros}
          tenantId={tenantId}
          sedeNombre={clase.sedeNombre ?? sedeNombre}
          canchaNombre={cancha?.nombre ?? clase.canchaNombre}
          onCerrado={alCerrar}
        />
      ) : null}

      {conCierre && (cargos.length || pago || movimientos.length) ? (
        <div className="sheet__slots">
          <h3 className="sheet__subtitulo">Cobros del cierre</h3>
          <ul className="cierre-lista">
            {cargos.map((cargo) => (
              <li key={cargo.id} className="cierre-lista__fila">
                <span className="cierre-lista__nombre">
                  {cargo.alumnoNombre}
                  <span className="cierre-lista__concepto">
                    {CONCEPTOS_CARGO_LABEL[cargo.concepto] ?? cargo.concepto}
                  </span>
                </span>
                <span className="cierre-lista__monto">
                  {formatearUSD(cargo.montoCents)}
                  <span className={`badge badge--${cargo.estado}`}>
                    {ESTADO_COBRO_LABEL[cargo.estado] ?? cargo.estado}
                  </span>
                </span>
              </li>
            ))}
            {movimientos.map((movimiento) => (
              <li key={movimiento.id} className="cierre-lista__fila">
                <span className="cierre-lista__nombre">
                  {nombrePorAlumno[movimiento.alumnoId] ?? 'Alumno'}
                  <span className="cierre-lista__concepto">
                    {MOTIVOS_MOVIMIENTO_LABEL[movimiento.motivo] ?? 'Crédito'}
                  </span>
                </span>
                <span className="cierre-lista__monto">
                  {movimiento.minutos} min
                  <span className="badge badge--pagado">Crédito</span>
                </span>
              </li>
            ))}
            {pago ? (
              <li className="cierre-lista__fila cierre-lista__fila--prof">
                <span className="cierre-lista__nombre">
                  {pago.profesorNombre}
                  <span className="cierre-lista__concepto">Pago al profesor</span>
                </span>
                <span className="cierre-lista__monto">
                  {formatearUSD(pago.montoCents)}
                  <span className={`badge badge--${pago.estado}`}>
                    {ESTADO_COBRO_LABEL[pago.estado] ?? pago.estado}
                  </span>
                </span>
              </li>
            ) : null}
          </ul>

          {!clase.facturada ? (
            <p className="parametros__hint">Cerrada sin facturar (fuerza mayor).</p>
          ) : null}

          {anulando ? (
            <div className="confirm-box">
              <p className="confirm-box__texto">
                ¿Anular el cierre? Los cargos y el pago quedan anulados y la clase vuelve a
                “reservada” para cerrarla de nuevo.
              </p>
              <BotonAccion
                onClick={anular}
                accion="anular-cierre"
                exito="Cierre anulado"
                textoOcupado="Anulando…"
                alExito={() => {
                  setCierre(null)
                  onChanged?.()
                }}
              >
                Sí, anular el cierre
              </BotonAccion>
              <button type="button" className="btn btn--secondary" onClick={() => setAnulando(false)}>
                No, volver
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--secondary"
                disabled={algoPagado}
                onClick={() => setAnulando(true)}
              >
                Anular cierre
              </button>
              {algoPagado ? (
                <p className="parametros__hint">
                  No se puede anular: hay un cargo o pago ya cobrado.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {puedeReprogramar ? (
        <button type="button" className="btn btn--secondary" onClick={() => onReprogramar?.(clase)}>
          Reprogramar
        </button>
      ) : null}
      {puedeCancelar ? (
        confirmando ? (
          <div className="confirm-box">
            <p className="confirm-box__texto">
              ¿Cancelar esta clase? Se libera el horario y el profesor queda disponible.
            </p>
            <BotonAccion
              onClick={cancelar}
              accion="cancelar-clase"
              sinExito
              textoOcupado="Cancelando…"
              alExito={() => {
                onChanged?.()
                onClose()
              }}
              alError={() => setConfirmando(false)}
            >
              Sí, cancelar la clase
            </BotonAccion>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setConfirmando(false)}
            >
              No, volver
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setConfirmando(true)}
          >
            Cancelar clase
          </button>
        )
      ) : null}
    </aside>
  )
}
