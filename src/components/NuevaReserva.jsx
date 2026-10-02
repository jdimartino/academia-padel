import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { crearClase, getProfesores, reprogramarClase } from '../firebase/db'
import {
  CATEGORIAS,
  HORA_MAX,
  HORA_MIN,
  aHoraHHmm,
  aMinutos,
  etiquetaCategoria,
} from '../lib/agenda'
import { formatearFechaLarga } from '../lib/fechas'
import { CloseIcon } from './Icons'

const DURACIONES = [60, 90]
const MODALIDADES = ['Grupal', 'Individual']

function opcionesDeHora() {
  const opciones = []
  for (let minuto = HORA_MIN * 60; minuto <= HORA_MAX * 60 - 30; minuto += 30) {
    opciones.push(aHoraHHmm(minuto))
  }
  return opciones
}

const HORAS = opcionesDeHora()

/*
 * Formulario de reserva. Con `clase` hace de reprogramación (prefill + update
 * transaccional); sin `clase` crea una reserva nueva. Mismo sheet de vidrio
 * que el detalle: bottom sheet en mobile y panel de 360px en desktop.
 * La validación de choques se hace ANTES de enviar contra las clases ya
 * cargadas del día; la transacción de db.js vuelve a validar igual.
 */
export default function NuevaReserva({
  tenantId,
  sede,
  canchas,
  fecha,
  clases,
  clase = null,
  onClose,
  onCreated,
}) {
  const { user } = useAuth()
  const esEdicion = Boolean(clase)
  const [canchaId, setCanchaId] = useState(clase?.canchaId ?? canchas[0]?.id ?? null)
  const [horaInicio, setHoraInicio] = useState(clase?.horaInicio ?? '18:00')
  const [duracion, setDuracion] = useState(
    clase ? (aMinutos(clase.horaFin) ?? 0) - (aMinutos(clase.horaInicio) ?? 0) : 60,
  )
  const [modalidad, setModalidad] = useState((clase?.cupo ?? 4) <= 1 ? 'Individual' : 'Grupal')
  const [categoria, setCategoria] = useState(clase?.categoria ?? '')
  const [profesorId, setProfesorId] = useState(clase?.profesorId ?? null)
  const [profesores, setProfesores] = useState(null)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let activo = true
    getProfesores(db, tenantId)
      .then((lista) => {
        if (!activo) return
        setProfesores(lista)
        setProfesorId((prev) => prev ?? lista[0]?.id ?? null)
      })
      .catch((err) => {
        if (!activo) return
        setProfesores([])
        setError(err.message)
      })
    return () => {
      activo = false
    }
  }, [tenantId])

  const inicio = aMinutos(horaInicio) ?? 0
  const fin = inicio + duracion
  const profesor = profesores?.find((p) => p.id === profesorId) ?? null
  // Al reprogramar, la propia clase no cuenta como conflicto consigo misma.
  const otrasClases = esEdicion ? clases.filter((c) => c.id !== clase.id) : clases

  const slots = useMemo(() => {
    const lista = []
    for (let minuto = inicio; minuto < fin; minuto += 30) lista.push(aHoraHHmm(minuto))
    return lista
  }, [inicio, fin])

  const problemas = useMemo(() => {
    const lista = []
    if (fin > HORA_MAX * 60) lista.push('La clase no puede terminar después de las 21:00.')

    const solapan = (otra) => {
      const ci = aMinutos(otra.horaInicio)
      const cf = aMinutos(otra.horaFin)
      return ci !== null && cf !== null && ci < fin && inicio < cf
    }
    const canchaOcupada = otrasClases.find(
      (c) => c.canchaId === canchaId && c.estado !== 'cancelada' && solapan(c),
    )
    if (canchaOcupada) {
      lista.push(
        `La cancha ya está ocupada de ${canchaOcupada.horaInicio} a ${canchaOcupada.horaFin}.`,
      )
    }
    if (profesorId) {
      const profeOcupado = otrasClases.find(
        (c) => c.profesorId === profesorId && c.estado !== 'cancelada' && solapan(c),
      )
      if (profeOcupado) {
        lista.push(
          `${profesor?.nombre ?? 'El profesor'} ya tiene clase de ${profeOcupado.horaInicio} a ${profeOcupado.horaFin}.`,
        )
      }
    }
    return lista
  }, [canchaId, fin, inicio, otrasClases, profesor, profesorId])

  const puedeEnviar = Boolean(canchaId && profesorId) && problemas.length === 0 && !enviando

  async function enviar(event) {
    event.preventDefault()
    if (!puedeEnviar) return
    setError('')
    setEnviando(true)
    try {
      const datos = {
        sedeId: sede.id,
        sedeNombre: sede.nombre,
        canchaId,
        profesorId,
        profesorNombre: profesor?.nombre ?? null,
        fecha,
        horaInicio,
        horaFin: aHoraHHmm(fin),
        cupo: modalidad === 'Individual' ? 1 : 4,
        categoria: categoria || null,
      }
      if (esEdicion) {
        await reprogramarClase(db, tenantId, clase.id, datos, { uid: user?.uid ?? null })
      } else {
        await crearClase(
          db,
          tenantId,
          { ...datos, alumnos: [], alumnoNombres: [] },
          { uid: user?.uid ?? null },
        )
      }
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <aside className="sheet glass-strong" role="dialog" aria-label="Nueva reserva">
      <header className="sheet__head">
        <div>
          <h2 className="sheet__titulo">{esEdicion ? 'Reprogramar clase' : 'Nueva reserva'}</h2>
          <p className="sheet__subtitulo">
            {sede?.nombre} · {formatearFechaLarga(fecha)}
          </p>
        </div>
        <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose} autoFocus>
          <CloseIcon />
        </button>
      </header>

      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}
      {problemas.map((problema) => (
        <p key={problema} className="alert alert--error" role="alert">
          {problema}
        </p>
      ))}

      <form className="form" onSubmit={enviar}>
        <div className="form__field">
          <span className="form__label">Cancha</span>
          <div className="chips-row">
            {canchas.map((cancha) => (
              <button
                type="button"
                key={cancha.id}
                className={`chip-cancha${cancha.id === canchaId ? ' is-sel' : ''}`}
                aria-pressed={cancha.id === canchaId}
                onClick={() => setCanchaId(cancha.id)}
              >
                {cancha.nombre}
              </button>
            ))}
          </div>
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="nr-hora">
            Hora de inicio
          </label>
          <select
            className="form__input"
            id="nr-hora"
            value={horaInicio}
            onChange={(e) => setHoraInicio(e.target.value)}
          >
            {HORAS.map((hora) => (
              <option key={hora} value={hora}>
                {hora}
              </option>
            ))}
          </select>
        </div>

        <div className="form__field">
          <span className="form__label">Duración</span>
          <div className="chips-row">
            {DURACIONES.map((minutos) => (
              <button
                type="button"
                key={minutos}
                className={`chip-cancha${minutos === duracion ? ' is-sel' : ''}`}
                aria-pressed={minutos === duracion}
                onClick={() => setDuracion(minutos)}
              >
                {minutos} min
              </button>
            ))}
          </div>
        </div>

        <div className="form__field">
          <span className="form__label">Modalidad</span>
          <div className="chips-row">
            {MODALIDADES.map((opcion) => (
              <button
                type="button"
                key={opcion}
                className={`chip-cancha${opcion === modalidad ? ' is-sel' : ''}`}
                aria-pressed={opcion === modalidad}
                onClick={() => setModalidad(opcion)}
              >
                {opcion}
              </button>
            ))}
          </div>
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="nr-categoria">
            Categoría (opcional)
          </label>
          <select
            className="form__input"
            id="nr-categoria"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            <option value="">Sin categoría</option>
            {CATEGORIAS.map((valor) => (
              <option key={valor} value={valor}>
                {etiquetaCategoria(valor)}
              </option>
            ))}
          </select>
        </div>

        <div className="form__field">
          <span className="form__label">Profesor</span>
          {profesores === null ? (
            <p className="aviso">Cargando profesores…</p>
          ) : profesores.length === 0 ? (
            <p className="aviso">Esta academia no tiene profesores activos.</p>
          ) : (
            <div className="chips-row">
              {profesores.map((profe) => (
                <button
                  type="button"
                  key={profe.id}
                  className={`chip-cancha${profe.id === profesorId ? ' is-sel' : ''}`}
                  aria-pressed={profe.id === profesorId}
                  onClick={() => setProfesorId(profe.id)}
                >
                  {profe.nombre}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sheet__slots">
          <h3 className="sheet__subtitulo">Bloques de 30 min</h3>
          <ul className="chips-slots">
            {slots.map((slot) => (
              <li key={slot} className="chip-slot">
                {slot}
              </li>
            ))}
          </ul>
        </div>

        <button className="btn" type="submit" disabled={!puedeEnviar}>
          {enviando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Reservar clase'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          Cancelar
        </button>
      </form>
    </aside>
  )
}
