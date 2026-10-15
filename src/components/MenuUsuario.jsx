import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

/*
 * Bloque de cuenta del panel: muestra el email de la sesión y el botón para
 * cerrar sesión. Vive al pie de `AppNav`, así aparece en el sidebar de desktop
 * y en el menú bottom-sheet de mobile sin duplicar lógica.
 */
export default function MenuUsuario() {
  const { user, logout } = useAuth()
  const [saliendo, setSaliendo] = useState(false)

  async function cerrarSesion() {
    setSaliendo(true)
    try {
      await logout()
    } finally {
      setSaliendo(false)
    }
  }

  return (
    <div className="menu-usuario">
      <div className="menu-usuario__info">
        <span className="menu-usuario__rol">Administrador</span>
        <span className="menu-usuario__email" title={user?.email ?? ''}>
          {user?.email ?? 'Sesión'}
        </span>
      </div>
      <button
        type="button"
        className="menu-usuario__salir"
        onClick={cerrarSesion}
        disabled={saliendo}
      >
        {saliendo ? 'Cerrando…' : 'Cerrar sesión'}
      </button>
    </div>
  )
}
