import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BotonAccion from '../components/BotonAccion'
import { useAuth } from '../context/AuthContext'
import { useAvisos } from '../context/AvisosContext'
import useAccion from '../hooks/useAccion'

/*
 * Mensajes propios para los códigos de Auth conocidos: son errores esperados y
 * su texto ya está escrito para el usuario, así que se muestran tal cual (sin
 * referencia). Cualquier otro código cae al diálogo de error técnico.
 */
const MESSAGES = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/user-not-found': 'El correo no es válido.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/too-many-requests': 'Demasiados intentos. Intenta de nuevo en unos minutos.',
  'auth/network-request-failed': 'Sin conexión a internet.',
}

export default function Login() {
  const { login } = useAuth()
  const { avisarError, mostrarErrorTecnico } = useAvisos()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const accion = useAccion()

  function handleSubmit(event) {
    event.preventDefault()
    accion.ejecutar(() => login(email, password), {
      accion: 'iniciar-sesion',
      sinExito: true,
      alExito: () => navigate(location.state?.from ?? '/', { replace: true }),
      alError: (err) => {
        const mensaje = MESSAGES[err?.code]
        if (mensaje) avisarError(mensaje)
        else mostrarErrorTecnico('iniciar-sesion', err)
      },
    })
  }

  return (
    <main className="page">
      <form className="form" onSubmit={handleSubmit} noValidate>
        <h1>Academia Pádel</h1>

        <div className="form__field">
          <label className="form__label" htmlFor="email">
            Correo
          </label>
          <input
            className="form__input"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="password">
            Contraseña
          </label>
          <input
            className="form__input"
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <BotonAccion type="submit" control={accion} textoOcupado="Entrando…">
          Iniciar sesión
        </BotonAccion>
      </form>
    </main>
  )
}
