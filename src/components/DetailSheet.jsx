import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { asignarAlumnos, cancelarClase, registrarAsistencia } from '../firebase/db'
import { CloseIcon } from './Icons'
import { estadoDe, formatHora12, tituloClase } from '../lib/agenda'
import { formatearFechaLarga } from '../lib/fechas'
import SelectorAlumnos from './SelectorAlumnos'

const ESTADOS_CERRADOS = ['pendiente_cobro', 'cobrada', 'cancelada']

const OPCIONES_ASISTENCIA = [
  { valor: 'presente', label: 'Presente' },
  { valor: 'ausente_avisada', label: 'Ausente avisada' },
  { valor: 'ausente_sin_aviso', label: 'Ausente sin aviso' },
]

/** Empareja IDs de alumnos con sus nombres denormalizados. */
function alumnosDeClase(clase) {
  const ids = clase.alumnos ?? []
  const nombres = clase.alumnoNombres ?? []
  return ids.map((id, i) => ({ id, nombre: nombres[i] ?? id }))
}

export default function DetailSheet({
  clase,
  canchas,
  clases = [],
  sedeNombre,
  tenantId,
  rol,
  onClose,
  onChanged,
  onReprogramar,
}) {
  const { user } = useAuth()
  const estado = estadoDe(clase.estado)
  const cancha = canchas.find((c) => c.id === clase.canchaId)
  const cupo = clase.cupo ?? 0
  const alumnos = alumnosDeClase(clase)

  const esAdmin = rol === 'administrador'
  // Solo el administrador registra asistencia: profesor, alumno y representante son
  // fichas sin acceso.
  const puedeAsistir = esAdmin && !ESTADOS_CERRADOS.includes(clase.estado)
  const puedeCancelar = esAdmin && !ESTADOS_CERRADOS.includes(clase.estado)
  const puedeReprogramar = esAdmin && clase.estado === 'reservada'
  // La asignación de alumnos solo se permite en una clase `reservada`.
  const puedeAsignar = esAdmin && clase.estado === 'reservada'

  const [asistencias, setAsistencias] = useState(() =>
    Object.fromEntries(
      alumnos.map((alumno) => {
        const previa = (clase.asistencias ?? []).find((a) => a.alumnoId === alumno.id)
        return [alumno.id, { estado: previa?.estado ?? 'presente', motivo: previa?.motivo ?? '' }]
      }),
    ),
  )
  // La selección se deriva de la clase (fuente de verdad): tras asignar, el
  // refresh del día trae la lista nueva y no hay copia local que se desincronice.
  const seleccion = alumnosDeClase(clase)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [guardandoAlumnos, setGuardandoAlumnos] = useState(false)

  function cambiarAsistencia(alumnoId, cambios) {
    setAsistencias((prev) => ({ ...prev, [alumnoId]: { ...prev[alumnoId], ...cambios } }))
  }

  async function cambiarAlumnos(nueva) {
    setError('')
    setGuardandoAlumnos(true)
    try {
      await asignarAlumnos(db, tenantId, clase.id, nueva.map((alumno) => alumno.id), {
        uid: user?.uid ?? null,
      })
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setGuardandoAlumnos(false)
    }
  }

  async function guardarAsistencia() {
    setError('')
    setOcupado(true)
    try {
      const registros = alumnos.map((alumno) => ({
        alumnoId: alumno.id,
        estado: asistencias[alumno.id]?.estado ?? 'presente',
        motivo: asistencias[alumno.id]?.motivo || null,
      }))
      await registrarAsistencia(db, tenantId, clase.id, registros, { uid: user?.uid ?? null })
      // La hoja queda abierta: el refresh trae el estado nuevo y la propia
      // clase ya no ofrece asistencia (quedó en pendiente_cobro).
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setOcupado(false)
    }
  }

  async function cancelar() {
    setError('')
    setOcupado(true)
    try {
      await cancelarClase(db, tenantId, clase.id, { uid: user?.uid ?? null })
      onChanged?.()
      onClose()
    } catch (err) {
      setError(err.message)
      setConfirmando(false)
    } finally {
      setOcupado(false)
    }
  }

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
          <dd>{cancha?.nombre ?? clase.canchaId}</dd>
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
        <div className="sheet__fila">
          <dt>Alumnos</dt>
          <dd>
            {alumnos.length} de {cupo}
          </dd>
        </div>
      </dl>

      {puedeAsignar ? (
        <div className="sheet__slots">
          <h3 className="sheet__subtitulo">Alumnos</h3>
          <SelectorAlumnos
            tenantId={tenantId}
            cupo={cupo}
            seleccionados={seleccion}
            onChange={cambiarAlumnos}
            clases={clases}
            claseId={clase.id}
            horaInicio={clase.horaInicio}
            horaFin={clase.horaFin}
          />
          {guardandoAlumnos ? <p className="aviso">Guardando alumnos…</p> : null}
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

      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}

      {puedeAsistir && alumnos.length ? (
        <div className="sheet__slots">
          <h3 className="sheet__subtitulo">Asistencia</h3>
          <ul className="asistencia-lista">
            {alumnos.map((alumno) => {
              const registro = asistencias[alumno.id] ?? { estado: 'presente', motivo: '' }
              const esAusencia = registro.estado !== 'presente'
              return (
                <li key={alumno.id} className="asistencia-fila">
                  <span className="asistencia-nombre">{alumno.nombre}</span>
                  <div className="seg" role="group" aria-label={`Asistencia de ${alumno.nombre}`}>
                    {OPCIONES_ASISTENCIA.map((opcion) => (
                      <button
                        key={opcion.valor}
                        type="button"
                        className={`seg__op${registro.estado === opcion.valor ? ' is-sel' : ''}`}
                        aria-pressed={registro.estado === opcion.valor}
                        onClick={() => cambiarAsistencia(alumno.id, { estado: opcion.valor })}
                      >
                        {opcion.label}
                      </button>
                    ))}
                  </div>
                  {esAusencia ? (
                    <input
                      className="form__input"
                      type="text"
                      placeholder="Motivo (opcional)"
                      value={registro.motivo}
                      onChange={(e) => cambiarAsistencia(alumno.id, { motivo: e.target.value })}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
          <button type="button" className="btn" disabled={ocupado} onClick={guardarAsistencia}>
            {ocupado ? 'Guardando…' : 'Guardar asistencia'}
          </button>
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
            <button type="button" className="btn" disabled={ocupado} onClick={cancelar}>
              {ocupado ? 'Cancelando…' : 'Sí, cancelar la clase'}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={ocupado}
              onClick={() => setConfirmando(false)}
            >
              No, volver
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={ocupado}
            onClick={() => setConfirmando(true)}
          >
            Cancelar clase
          </button>
        )
      ) : null}
    </aside>
  )
}
