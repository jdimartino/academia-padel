import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import BotonAccion from './BotonAccion'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { getMiMembresia } from '../firebase/db'

/** Etiqueta legible del rol real dentro de la academia. */
function etiquetaRol(rol) {
  if (rol === 'administrador') return 'Administrador'
  if (rol === 'profesor') return 'Profesor'
  return 'Sin acceso'
}

/*
 * Bloque de cuenta del panel: muestra el rol real y el email de la sesión, y el
 * botón para cerrar sesión. Vive al pie de `AppNav`, así aparece en el sidebar de
 * desktop y en el menú bottom-sheet de mobile sin duplicar lógica.
 *
 * El rol puede venir por prop (quien ya leyó la membresía, p. ej. PageChrome);
 * si no, se lee la propia membresía (única lectura permitida a un no-admin).
 */
export default function MenuUsuario({ rol = undefined }) {
  const { academia } = useParams()
  const { user, logout } = useAuth()
  const [rolLeido, setRolLeido] = useState(undefined)

  useEffect(() => {
    if (rol !== undefined || !academia || !user?.uid) return undefined
    let activo = true
    getMiMembresia(db, academia, user.uid)
      .then((membresia) => {
        if (activo) setRolLeido(membresia?.rol ?? null)
      })
      .catch(() => {
        if (activo) setRolLeido(null)
      })
    return () => {
      activo = false
    }
  }, [rol, academia, user?.uid])

  const rolMostrado = rol !== undefined ? rol : rolLeido

  return (
    <div className="menu-usuario">
      <div className="menu-usuario__info">
        <span className="menu-usuario__rol">
          {rolMostrado === undefined ? '…' : etiquetaRol(rolMostrado)}
        </span>
        <span className="menu-usuario__email" title={user?.email ?? ''}>
          {user?.email ?? 'Sesión'}
        </span>
      </div>
      <BotonAccion
        onClick={() => logout()}
        accion="cerrar-sesion"
        sinExito
        textoOcupado="Cerrando…"
        className="menu-usuario__salir"
      >
        Cerrar sesión
      </BotonAccion>
    </div>
  )
}
