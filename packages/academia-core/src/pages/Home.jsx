import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { getMisAccesosProfesor, getMisMembresias } from '../firebase/db'

/*
 * Resuelve a dónde va el usuario al iniciar sesión. El administrador (con
 * `miembros`) entra a la agenda del primer tenant activo; el profesor (con
 * `usuarios`, sin membresía) entra a la pantalla de asistencia de su academia.
 * Cualquier otra cuenta cae en el aviso de "no pertenece a ninguna academia".
 */
export default function Home() {
  const { user } = useAuth()
  const [estado, setEstado] = useState({ cargando: true, destino: null, error: '' })

  useEffect(() => {
    let activo = true
    getMisMembresias(db, user.uid)
      .then(async (membresias) => {
        const admin = membresias.find((m) => m.activo !== false && m.rol === 'administrador')
        if (admin) return { destino: `/${admin.tenantId}/agenda`, error: '' }
        const accesos = await getMisAccesosProfesor(db, user.uid)
        if (accesos[0]) return { destino: `/${accesos[0].tenantId}/asistencia`, error: '' }
        return { destino: null, error: '' }
      })
      .then((res) => {
        if (activo) setEstado({ cargando: false, ...res })
      })
      .catch((err) => {
        if (activo) setEstado({ cargando: false, destino: null, error: err.message })
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

  if (estado.destino) {
    return <Navigate to={estado.destino} replace />
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
