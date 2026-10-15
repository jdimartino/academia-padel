import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import Background from '../components/Background'
import BotonAccion from '../components/BotonAccion'
import EstadoMensaje from '../components/EstadoMensaje'
import { LogoMark } from '../components/Icons'
import { useAuth } from '../context/AuthContext'
import { useCargando } from '../context/CargandoContext'
import { db } from '../firebase/config'
import {
  getClasesDeProfesor,
  getUsuarioProfesor,
  guardarAsistenciaProfesor,
} from '../firebase/db'
import { formatHora12 } from '../lib/agenda'
import { formatearFechaLarga } from '../lib/fechas'

/*
 * Estados que carga el profesor en móvil. El enum es propio (el del cierre es
 * otro); la equivalencia la resuelve `src/lib/profesores.js`.
 */
const OPCIONES = [
  { valor: 'presente', label: 'Presente' },
  { valor: 'ausente_con_aviso', label: 'Avisó' },
  { valor: 'ausente_sin_aviso', label: 'Faltó' },
]

/** Marcas iniciales de una clase: lo ya guardado por el profesor o "presente". */
function marcasIniciales(clase) {
  const guardado = clase.asistenciaProfesor?.porAlumno ?? {}
  return Object.fromEntries((clase.alumnos ?? []).map((id) => [id, guardado[id] ?? 'presente']))
}

/*
 * Asistencia del profesor (Fase 7), pensada para el móvil. Lista las clases
 * propias desde hoy; en las ABIERTAS (`reservada`) se marca presente / avisó /
 * faltó y se guarda; las cerradas se ven en solo lectura. No hay nada del panel
 * de administración: todo lo protegen las reglas (solo asistencia, solo clases
 * propias y abiertas).
 */
export default function AsistenciaProfesor() {
  const { academia } = useParams()
  const { user, logout } = useAuth()
  const { iniciar: iniciarCarga, terminar: terminarCarga } = useCargando()
  const [acceso, setAcceso] = useState(null)
  const [clases, setClases] = useState(null)
  const [error, setError] = useState('')
  const [marcas, setMarcas] = useState({})
  const [guardadas, setGuardadas] = useState({})
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    let activo = true
    iniciarCarga()
    async function cargar() {
      const propio = await getUsuarioProfesor(db, academia, user.uid)
      if (!propio?.profesorId) throw new Error('El acceso no tiene profesor asociado')
      const lista = await getClasesDeProfesor(db, academia, propio.profesorId)
      if (!activo) return
      setAcceso(propio)
      setClases(lista)
      setMarcas(Object.fromEntries(lista.map((c) => [c.id, marcasIniciales(c)])))
      setError('')
    }
    cargar()
      .catch(() => {
        if (!activo) return
        setClases([])
        setError('No se pudieron cargar tus clases. Intenta de nuevo.')
      })
      .finally(terminarCarga)
    return () => {
      activo = false
    }
  }, [academia, user.uid, recarga, iniciarCarga, terminarCarga])

  function marcar(claseId, alumnoId, valor) {
    setMarcas((prev) => ({ ...prev, [claseId]: { ...prev[claseId], [alumnoId]: valor } }))
    setGuardadas((prev) => (prev[claseId] ? { ...prev, [claseId]: false } : prev))
  }

  async function guardar(clase) {
    await guardarAsistenciaProfesor(db, academia, clase.id, marcas[clase.id] ?? {}, {
      uid: user.uid,
      profesorId: acceso?.profesorId,
    })
    setGuardadas((prev) => ({ ...prev, [clase.id]: true }))
    setRecarga((v) => v + 1)
  }

  if (clases === null && !error) return <EstadoMensaje titulo="Cargando…" />

  const lista = clases ?? []

  return (
    <div className="app app--mobile">
      <Background />
      <header className="p-header">
        <div className="m-marca">
          <LogoMark size={28} />
          <span className="m-marca__texto">Mi asistencia</span>
        </div>
        <BotonAccion
          onClick={() => logout()}
          accion="cerrar-sesion"
          sinExito
          textoOcupado="Saliendo…"
          className="icon-btn"
        >
          Salir
        </BotonAccion>
      </header>

      <main className="asistencia-profesor">
        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        {!error && lista.length === 0 ? (
          <p className="aviso">No tienes clases programadas.</p>
        ) : null}

        {lista.map((clase) => {
          const abierta = clase.estado === 'reservada'
          const alumnos = (clase.alumnos ?? []).map((id, i) => ({
            id,
            nombre: (clase.alumnoNombres ?? [])[i] ?? 'Alumno',
          }))
          return (
            <article key={clase.id} className="clase-card">
              <header className="clase-card__head">
                <h2 className="clase-card__titulo">
                  {clase.canchaNombre ?? 'Cancha'}
                  {clase.sedeNombre ? <span className="clase-card__sede">{clase.sedeNombre}</span> : null}
                </h2>
                <p className="clase-card__cuando">
                  {formatearFechaLarga(clase.fecha)} · {formatHora12(clase.horaInicio)}-
                  {formatHora12(clase.horaFin)}
                </p>
              </header>

              <ul className="asistencia-lista">
                {alumnos.map((alumno) => (
                  <li key={alumno.id} className="asistencia-fila">
                    <span className="asistencia-nombre">{alumno.nombre}</span>
                    {abierta ? (
                      <div className="seg" role="group" aria-label={`Asistencia de ${alumno.nombre}`}>
                        {OPCIONES.map((opcion) => (
                          <button
                            key={opcion.valor}
                            type="button"
                            className={`seg__op${
                              marcas[clase.id]?.[alumno.id] === opcion.valor ? ' is-sel' : ''
                            }`}
                            aria-pressed={marcas[clase.id]?.[alumno.id] === opcion.valor}
                            onClick={() => marcar(clase.id, alumno.id, opcion.valor)}
                          >
                            {opcion.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="clase-card__cerrado">Cerrada</span>
                    )}
                  </li>
                ))}
              </ul>

              {abierta ? (
                <BotonAccion
                  onClick={() => guardar(clase)}
                  accion="guardar-asistencia"
                  exito="Asistencia guardada"
                  textoOcupado="Guardando…"
                  className="btn btn--primary"
                >
                  Guardar asistencia
                </BotonAccion>
              ) : (
                <p className="aviso">
                  {clase.asistenciaProfesor ? 'Asistencia confirmada' : 'Clase cerrada por la academia'}
                </p>
              )}
              {guardadas[clase.id] ? (
                <p className="clase-card__ok" role="status">
                  Guardado
                </p>
              ) : null}
            </article>
          )
        })}
      </main>
    </div>
  )
}
