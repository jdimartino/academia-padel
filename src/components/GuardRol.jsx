import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import EstadoMensaje from './EstadoMensaje'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { getUsuarioProfesor } from '../firebase/db'

/*
 * Guarda de rol para rutas de no-administrador (p. ej. la asistencia del
 * profesor). Monta la pantalla solo si el documento de acceso propio existe,
 * está activo y su rol coincide; si no, muestra el aviso. Es una guarda de UX:
 * la protección real la hacen las reglas de Firestore.
 */
export default function GuardRol({ rol, children }) {
  const { academia } = useParams()
  const { user } = useAuth()
  const [estado, setEstado] = useState({ cargando: true, ok: false })

  useEffect(() => {
    let activo = true
    getUsuarioProfesor(db, academia, user.uid)
      .then((acceso) => {
        if (activo) {
          setEstado({ cargando: false, ok: acceso?.activo === true && acceso?.rol === rol })
        }
      })
      .catch(() => {
        if (activo) setEstado({ cargando: false, ok: false })
      })
    return () => {
      activo = false
    }
  }, [academia, user.uid, rol])

  if (estado.cargando) return <EstadoMensaje titulo="Cargando…" />
  if (!estado.ok) return <EstadoMensaje titulo="Esta cuenta no tiene acceso a esta academia" />

  return children
}
