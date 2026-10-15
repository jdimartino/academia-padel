import { useEffect, useState } from 'react'
import { crearCuentaAuth } from '../firebase/authProfesor'
import { db } from '../firebase/config'
import {
  LIMITE_MIEMBROS,
  cambiarActivoMiembro,
  crearAccesoAdmin,
  listarMiembros,
} from '../firebase/db'
import { useAuth } from '../context/AuthContext'
import { useAvisos } from '../context/AvisosContext'

/** Etiquetas de los roles del modelo. */
const ROL_LABEL = {
  administrador: 'Administrador',
  profesor: 'Profesor',
  alumno_adulto: 'Alumno adulto',
  alumno_menor: 'Alumno menor',
}

/*
 * Sección "Administradores" de Configuración. El admin crea la cuenta de otro
 * administrador (email + contraseña temporal + nombre) y activa o desactiva su
 * acceso. Nunca puede tocar su propia membresía (las reglas lo impiden: así no
 * se auto-desactiva ni se auto-degrada). La contraseña no se guarda ni se
 * muestra: solo viaja a `crearCuentaAuth`, que usa una instancia secundaria.
 */
export default function ConfigAdministradores({ tenantId }) {
  const { user } = useAuth()
  const { mostrarExito, mostrarErrorTecnico } = useAvisos()
  const [miembros, setMiembros] = useState(null)
  const [error, setError] = useState('')
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let activo = true
    listarMiembros(db, tenantId, { limite: LIMITE_MIEMBROS })
      .then((lista) => {
        if (!activo) return
        setMiembros(lista)
        setError('')
      })
      .catch(() => {
        if (!activo) return
        setMiembros([])
        setError('No se pudieron cargar los administradores. Intenta de nuevo.')
      })
    return () => {
      activo = false
    }
  }, [tenantId, version])

  async function crear(evento) {
    evento.preventDefault()
    if (!nombre.trim() || !email.trim()) {
      setError('Escribe el nombre y el email del administrador')
      return
    }
    if ((password ?? '').length < 6) {
      setError('La contraseña temporal necesita al menos 6 caracteres')
      return
    }
    setOcupado(true)
    setError('')
    try {
      await crearAccesoAdmin(
        db,
        tenantId,
        { email, password, nombre },
        { crearCuenta: crearCuentaAuth, uidActual: user?.uid ?? null },
      )
      mostrarExito('Administrador creado. Comparte la contraseña temporal.')
      setNombre('')
      setEmail('')
      setPassword('')
      setVersion((v) => v + 1)
    } catch (err) {
      if (err?.message) setError(err.message)
      mostrarErrorTecnico('crear-acceso-admin', err)
    } finally {
      setOcupado(false)
    }
  }

  async function alternar(miembro) {
    setOcupado(true)
    try {
      await cambiarActivoMiembro(db, tenantId, miembro.id, miembro.activo === false, {
        actualizadoPor: user?.uid ?? null,
      })
      mostrarExito(miembro.activo === false ? 'Acceso reactivado' : 'Acceso desactivado')
      setVersion((v) => v + 1)
    } catch (err) {
      mostrarErrorTecnico('cambiar-acceso-admin', err)
    } finally {
      setOcupado(false)
    }
  }

  const lista = miembros ?? []
  const cargando = miembros === null

  return (
    <div className="detalle glass" aria-label="Administradores">
      <h2 className="lista-sedes__titulo">Administradores</h2>
      <p className="general__nota">
        Los administradores ven toda la academia: agenda, cobros, fichas y configuración. Solo un
        administrador activo puede crear o desactivar el acceso de otros. Nunca puedes desactivar
        tu propia cuenta.
      </p>

      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="parametros" onSubmit={crear}>
        <div className="parametros__bloque">
          <h3 className="parametros__titulo">Nuevo administrador</h3>
          <label className="parametros__campo">
            <span className="form__label">Nombre</span>
            <input
              className="form__input"
              type="text"
              autoComplete="off"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
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
          <button type="submit" className="btn btn--primary" disabled={ocupado}>
            {ocupado ? 'Creando…' : 'Crear administrador'}
          </button>
        </div>
      </form>

      <div className="parametros__bloque">
        <h3 className="parametros__titulo">Con acceso</h3>
        {cargando ? (
          <p className="aviso">Cargando…</p>
        ) : lista.length === 0 ? (
          <p className="aviso">Todavía no hay administradores.</p>
        ) : (
          <ul className="lista-sedes__items">
            {lista.map((miembro) => {
              const esUnoMismo = miembro.id === user?.uid
              const activo = miembro.activo !== false
              return (
                <li key={miembro.id} className="lista-sedes__item">
                  <span className="admin-item__texto">
                    <span className="admin-item__nombre">
                      {miembro.nombre || miembro.email || miembro.id}
                      {esUnoMismo ? <span className="parametros__hint"> (tú)</span> : null}
                    </span>
                    <span className="parametros__hint">
                      {ROL_LABEL[miembro.rol] ?? miembro.rol}
                      {miembro.email ? ` · ${miembro.email}` : ''}
                      {activo ? '' : ' · inactivo'}
                    </span>
                  </span>
                  {esUnoMismo ? (
                    <span className="pill-estado">Sesión actual</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={ocupado}
                      onClick={() => alternar(miembro)}
                    >
                      {activo ? 'Desactivar' : 'Reactivar'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
