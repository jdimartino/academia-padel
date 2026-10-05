import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { crearClase, getProfesores, nombreCompleto, reprogramarClase } from '../firebase/db'
import {
  CATEGORIAS,
  HORA_CIERRE_CLASE,
  aHoraHHmm,
  aMinutos,
  etiquetaCategoria,
  opcionesDeInicio,
} from '../lib/agenda'
import { formatearFechaLarga } from '../lib/fechas'
import { CloseIcon } from './Icons'
import SelectorAlumnos from './SelectorAlumnos'

const DURACIONES = [60, 120]
const MODALIDADES = ['Grupal', 'Individual']
/** Cierre de la jornada: ninguna clase puede terminar después de las 23:00. */
const FIN_ULTIMO = HORA_CIERRE_CLASE * 60

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
  const [alumnosSel, setAlumnosSel] = useState(() => {
    const ids = clase?.alumnos ?? []
    const nombres = clase?.alumnoNombres ?? []
    return ids.map((id, i) => ({ id, nombre: nombres[i] ?? id }))
  })
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let activo = true
    // Solo los profesores asignados a la sede de la clase: la transacción de
    // db.js rechaza a cualquier otro.
    getProfesores(db, tenantId, { sedeId: sede?.id })
      .then((lista) => {
        if (!activo) return
        setProfesores(lista)
        // Si el profesor actual no dicta en esta sede, se cae al primero.
        setProfesorId((prev) => (lista.some((p) => p.id === prev) ? prev : (lista[0]?.id ?? null)))
      })
      .catch((err) => {
        if (!activo) return
        setProfesores([])
        setError(err.message)
      })
    return () => {
      activo = false
    }
  }, [tenantId, sede?.id])

  const inicio = aMinutos(horaInicio) ?? 0
  const fin = inicio + duracion
  const cupo = modalidad === 'Individual' ? 1 : 4
  const profesor = profesores?.find((p) => p.id === profesorId) ?? null
  // Solo horas en punto que, con la duración elegida, terminen a más tardar 23:00.
  const horas = opcionesDeInicio(duracion)

  // Al acortar la duración, la hora elegida podría quedar fuera de la lista.
  useEffect(() => {
    setHoraInicio((hora) => (horas.includes(hora) ? hora : (horas[horas.length - 1] ?? hora)))
    // `horas` se recalcula con la duración; solo interesa cuando cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duracion])

  // Al cambiar de modalidad la selección no puede quedar por encima del cupo.
  function elegirModalidad(opcion) {
    const nuevoCupo = opcion === 'Individual' ? 1 : 4
    setModalidad(opcion)
    setAlumnosSel((prev) => (prev.length > nuevoCupo ? prev.slice(0, nuevoCupo) : prev))
  }
  // Al reprogramar, la propia clase no cuenta como conflicto consigo misma.
  const otrasClases = esEdicion ? clases.filter((c) => c.id !== clase.id) : clases

  const problemas = useMemo(() => {
    const lista = []
    if (fin > FIN_ULTIMO) lista.push('La clase no puede terminar después de las 23:00.')

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
          `${nombreCompleto(profesor) || 'El profesor'} ya tiene clase de ${profeOcupado.horaInicio} a ${profeOcupado.horaFin}.`,
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
        profesorNombre: nombreCompleto(profesor) || null,
        fecha,
        horaInicio,
        horaFin: aHoraHHmm(fin),
        cupo,
        categoria: categoria || null,
        alumnos: alumnosSel.map((alumno) => alumno.id),
      }
      let claseId
      if (esEdicion) {
        const resultado = await reprogramarClase(
          db,
          tenantId,
          clase.id,
          datos,
          { uid: user?.uid ?? null },
        )
        claseId = resultado.claseId
      } else {
        const resultado = await crearClase(db, tenantId, datos, { uid: user?.uid ?? null })
        claseId = resultado.claseId
      }
      onCreated(claseId)
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
            {horas.map((hora) => (
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
                {minutos / 60} h
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
                onClick={() => elegirModalidad(opcion)}
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
            <p className="aviso">No hay profesores asignados a esta sede.</p>
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
                  {nombreCompleto(profe)}
                </button>
              ))}
            </div>
          )}
        </div>

        <SelectorAlumnos
          tenantId={tenantId}
          cupo={cupo}
          seleccionados={alumnosSel}
          onChange={setAlumnosSel}
          clases={clases}
          claseId={clase?.id ?? null}
          horaInicio={horaInicio}
          horaFin={aHoraHHmm(fin)}
        />

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
