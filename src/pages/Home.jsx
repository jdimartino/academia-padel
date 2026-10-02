import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { getMisMembresias } from '../firebase/db'

/*
 * Resuelve el tenant del usuario con getMisMembresias y redirige a
 * /{academia}/agenda. Si tiene varias membresías activas, entra a la primera.
 */
export default function Home() {
  const { user } = useAuth()
  const [estado, setEstado] = useState({ cargando: true, tenantId: null, error: '' })

  useEffect(() => {
    let activo = true
    getMisMembresias(db, user.uid)
      .then((membresias) => {
        if (!activo) return
        const activa = membresias.find((m) => m.activo !== false) ?? membresias[0]
        setEstado({ cargando: false, tenantId: activa?.tenantId ?? null, error: '' })
      })
      .catch((err) => {
        if (activo) setEstado({ cargando: false, tenantId: null, error: err.message })
      })
    return () => {
      activo = false
    }
  }, [user.uid])

  if (estado.cargando) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        Cargando…
      </div>
    )
  }

  if (estado.tenantId) {
    return <Navigate to={`/${estado.tenantId}/agenda`} replace />
  }

  return (
    <main className="page">
      <p className="alert alert--error" role="alert">
        {estado.error
          ? `No se pudieron leer las membresías: ${estado.error}`
          : 'El usuario no pertenece a ninguna academia.'}
      </p>
    </main>
  )
}
