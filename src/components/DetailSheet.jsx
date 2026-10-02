import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { cancelarClase, registrarAsistencia } from '../firebase/db'
import { CloseIcon } from './Icons'
import { aHoraHHmm, estadoDe, rangoClase, tituloClase } from '../lib/agenda'
import { formatearFechaLarga } from '../lib/fechas'

const ESTADOS_CERRADOS = ['pendiente_cobro', 'cobrada', 'cancelada']

function slotsDeClase(clase) {
  const rango = rangoClase(clase)
  if (!rango) return []
  const slots = []
  for (let m = rango.inicio; m < rango.fin; m += 30) slots.push(aHoraHHmm(m))
  return slots
}

/** Empareja IDs de alumnos con sus nombres denormalizados. */
function alumnosDeClase(clase) {
  const ids = clase.alumnos ?? []
  const nombres = clase.alumnoNombres ?? []
  return ids.map((id, i) => ({ id, nombre: nombres[i] ?? id }))
}

export default function DetailSheet({
  clase,
  canchas,
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
  // Solo el administrador registra asistencia: profesor, alumno y tutor son
  // fichas sin acceso.
  const puedeAsistir = esAdmin && !ESTADOS_CERRADOS.includes(clase.estado)
  const puedeCancelar = esAdmin && !ESTADOS_CERRADOS.includes(clase.estado)
  const puedeReprogramar = esAdmin && clase.estado === 'reservada'

  const [asistencias, setAsistencias] = useState(() =>
    Object.fromEntries(
      alumnos.map((alumno) => {
        const previa = (clase.asistencias ?? []).find((a) => a.alumnoId === alumno.id)
        return [alumno.id, { estado: previa?.estado ?? 'presente', motivo: previa?.motivo ?? '' }]
      }),
    ),
  )
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [confirmando, setConfirmando] = useState(false)

  function cambiarAsistencia(alumnoId, cambios) {
    setAsistencias((prev) => ({ ...prev, [alumnoId]: { ...prev[alumnoId], ...cambios } }))
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
            {clase.horaInicio}–{clase.horaFin}
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

      <div className="sheet__slots">
        <h3 className="sheet__subtitulo">Bloques de 30 min</h3>
        <ul className="chips-slots">
          {slotsDeClase(clase).map((slot) => (
            <li key={slot} className="chip-slot">
              {slot}
            </li>
          ))}
        </ul>
      </div>

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
              return (
                <li key={alumno.id} className="asistencia-fila">
                  <span className="asistencia-nombre">{alumno.nombre}</span>
                  <div className="chips-row">
                    <button
                      type="button"
                      className={`chip-cancha${registro.estado === 'presente' ? ' is-sel' : ''}`}
                      aria-pressed={registro.estado === 'presente'}
                      onClick={() => cambiarAsistencia(alumno.id, { estado: 'presente' })}
                    >
                      Presente
                    </button>
                    <button
                      type="button"
                      className={`chip-cancha${registro.estado === 'ausente_sin_aviso' ? ' is-sel' : ''}`}
                      aria-pressed={registro.estado === 'ausente_sin_aviso'}
                      onClick={() => cambiarAsistencia(alumno.id, { estado: 'ausente_sin_aviso' })}
                    >
                      Ausente
                    </button>
                  </div>
                  {registro.estado === 'ausente_sin_aviso' ? (
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
