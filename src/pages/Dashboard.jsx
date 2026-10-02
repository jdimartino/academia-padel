import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { getMisMembresias } from '../firebase/db'

export default function Dashboard() {
  const { user, logout } = useAuth()
  const [membresias, setMembresias] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let activo = true
    getMisMembresias(db, user.uid)
      .then((resultado) => {
        if (activo) setMembresias(resultado)
      })
      .catch((err) => {
        if (activo) setError(err.message)
      })
    return () => {
      activo = false
    }
  }, [user.uid])

  return (
    <main className="page">
      <header className="page__header">
        <h1>Panel</h1>
        <button className="btn btn--secondary" type="button" onClick={logout}>
          Cerrar sesión
        </button>
      </header>

      <p>
        Sesión iniciada como <strong>{user?.email}</strong>.
      </p>

      {error ? (
        <p className="alert alert--error" role="alert">
          No se pudo leer la membresía desde el emulador: {error}
        </p>
      ) : null}

      {membresias === null && !error ? <p>Cargando membresías…</p> : null}

      {membresias?.length === 0 ? (
        <p className="alert alert--error" role="alert">
          El usuario no pertenece a ninguna academia.
        </p>
      ) : null}

      {membresias?.length ? (
        <ul>
          {membresias.map((m) => (
            <li key={m.tenantId}>
              <strong>{m.tenantId}</strong> — {m.rol}
            </li>
          ))}
        </ul>
      ) : null}

      <p>Las sedes, canchas, profesores, clases, asistencia y facturación se suman acá.</p>
    </main>
  )
}
