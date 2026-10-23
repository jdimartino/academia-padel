import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import EstadoMensaje from './EstadoMensaje'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { getMiMembresia } from '../firebase/db'

/*
 * Guarda de ADMINISTRADOR para rutas solo-admin (p. ej. Reportes). Monta la
 * pantalla solo si la membresía propia está activa y con rol administrador. Es
 * una guarda de UX: la protección real la hacen las reglas de Firestore (un
 * profesor no tiene membresía y no puede leer los datos de los informes).
 */
export default function GuardAdmin({ children }) {
  const { academia } = useParams()
  const { user } = useAuth()
  const [estado, setEstado] = useState({ cargando: true, ok: false })

  useEffect(() => {
    let activo = true
    getMiMembresia(db, academia, user.uid)
      .then((membresia) => {
        if (activo) setEstado({ cargando: false, ok: membresia?.activo === true && membresia?.rol === 'administrador' })
      })
      .catch(() => {
        if (activo) setEstado({ cargando: false, ok: false })
      })
    return () => {
      activo = false
    }
  }, [academia, user.uid])

  if (estado.cargando) return <EstadoMensaje titulo="Cargando…" />
  if (!estado.ok) return <EstadoMensaje titulo="Esta cuenta no tiene acceso a esta academia" />

  return children
}
