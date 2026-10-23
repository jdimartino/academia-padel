import { useEffect, useMemo, useState } from 'react'
import { crearCuentaAuthProfesor } from '../firebase/authProfesor'
import { db } from '../firebase/config'
import {
  LIMITE_PROFESORES,
  cambiarActivoProfesor,
  crearAccesoProfesor,
  getProfesores,
  listarUsuariosProfesor,
  nombreCompleto,
} from '../firebase/db'
import { useAuth } from '../context/AuthContext'
import { useAvisos } from '../context/AvisosContext'
import useAccion from '../hooks/useAccion'
import BotonAccion from './BotonAccion'

/*
 * Sección "Profesores con acceso" de Configuración (Fase 7). El admin crea la
 * cuenta de un profesor (email + contraseña temporal + ficha) y activa o
 * desactiva su acceso. La contraseña nunca se guarda ni se muestra: solo viaja a
 * `crearCuentaAuthProfesor`, que usa una instancia secundaria de Firebase.
 */
export default function ConfigProfesores({ tenantId }) {
  const { user } = useAuth()
  const { avisarError, mostrarErrorTecnico } = useAvisos()
  const [profesores, setProfesores] = useState([])
  const [accesos, setAccesos] = useState(null)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [profesorId, setProfesorId] = useState('')
  const [version, setVersion] = useState(0)
  const accionCrear = useAccion()

  useEffect(() => {
    let activo = true
    Promise.all([
      getProfesores(db, tenantId, { estado: 'activos', limite: LIMITE_PROFESORES }),
      listarUsuariosProfesor(db, tenantId),
    ])
      .then(([listaProfes, listaAccesos]) => {
        if (!activo) return
        setProfesores(listaProfes)
        setAccesos(listaAccesos)
        setError('')
      })
      .catch(() => {
        if (!activo) return
        setAccesos([])
        setError('No se pudieron cargar los accesos. Intenta de nuevo.')
      })
    return () => {
      activo = false
    }
  }, [tenantId, version])

  const nombrePorProfesor = useMemo(
    () => Object.fromEntries(profesores.map((p) => [p.id, nombreCompleto(p)])),
    [profesores],
  )

  function crear(evento) {
    evento.preventDefault()
    if (!email.trim() || !profesorId) {
      setError('Elige un profesor y escribe su email')
      return
    }
    if ((password ?? '').length < 6) {
      setError('La contraseña temporal necesita al menos 6 caracteres')
      return
    }
    setError('')
    accionCrear.ejecutar(
      () =>
        crearAccesoProfesor(
          db,
          tenantId,
          { email, password, profesorId },
          { crearCuenta: crearCuentaAuthProfesor },
        ),
      {
        accion: 'crear-acceso-profesor',
        exito: 'Acceso creado. Comparte la contraseña temporal.',
        alExito: () => {
          setEmail('')
          setPassword('')
          setProfesorId('')
          setVersion((v) => v + 1)
        },
        alError: (err) => {
          if (err?.message) {
            setError(err.message)
            avisarError(err.message)
          } else {
            mostrarErrorTecnico('crear-acceso-profesor', err)
          }
        },
      },
    )
  }

  async function alternar(acceso) {
    await cambiarActivoProfesor(db, tenantId, acceso.id, acceso.activo === false, {
      actualizadoPor: user?.uid ?? null,
    })
    setVersion((v) => v + 1)
  }

  const lista = accesos ?? []
  const cargando = accesos === null

  return (
    <div className="detalle glass" aria-label="Profesores con acceso">
      <h2 className="lista-sedes__titulo">Profesores con acceso</h2>
      <p className="general__nota">
        Cada profesor puede cargar la asistencia de SUS clases abiertas desde el móvil. No ve
        cobros, fichas de alumnos ni nada de administración.
      </p>

      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="parametros" onSubmit={crear}>
        <div className="parametros__bloque">
          <h3 className="parametros__titulo">Nuevo acceso</h3>
          <label className="parametros__campo">
            <span className="form__label">Profesor</span>
            <select
              className="form__input"
              value={profesorId}
              onChange={(e) => setProfesorId(e.target.value)}
            >
              <option value="">Elige un profesor…</option>
              {profesores.map((p) => (
                <option key={p.id} value={p.id}>
                  {nombreCompleto(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="parametros__campo">
            <span className="form__label">Email</span>
            <input
              className="form__input"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="parametros__campo">
            <span className="form__label">Contraseña temporal</span>
            <input
              className="form__input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="parametros__hint">No se guarda: compártela y que la cambie.</span>
          </label>
          <BotonAccion type="submit" control={accionCrear} textoOcupado="Creando…" className="btn btn--primary">
            Crear acceso
          </BotonAccion>
        </div>
      </form>

      <div className="parametros__bloque">
        <h3 className="parametros__titulo">Con acceso</h3>
        {cargando ? (
          <p className="aviso">Cargando…</p>
        ) : lista.length === 0 ? (
          <p className="aviso">Todavía no hay profesores con acceso.</p>
        ) : (
          <ul className="lista-sedes__items">
            {lista.map((acceso) => (
              <li key={acceso.id} className="lista-sedes__item">
                <span>
                  {nombrePorProfesor[acceso.profesorId] ?? 'Profesor'}
                  <span className="parametros__hint"> {acceso.email}</span>
                </span>
                <BotonAccion
                  onClick={() => alternar(acceso)}
                  accion="cambiar-acceso-profesor"
                  exito={acceso.activo === false ? 'Acceso reactivado' : 'Acceso desactivado'}
                  textoOcupado="Guardando…"
                  className="btn btn--secondary"
                >
                  {acceso.activo === false ? 'Reactivar' : 'Desactivar'}
                </BotonAccion>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
