import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAvisos } from '../context/AvisosContext'

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
  const { mostrarError, mostrarErrorTecnico } = useAvisos()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    try {
      await login(email, password)
      navigate(location.state?.from ?? '/', { replace: true })
    } catch (err) {
      const mensaje = MESSAGES[err?.code]
      if (mensaje) mostrarError(mensaje)
      else mostrarErrorTecnico('iniciar-sesion', err)
    } finally {
      setSubmitting(false)
    }
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

        <button className="btn" type="submit" disabled={submitting}>
          {submitting ? 'Entrando…' : 'Iniciar sesión'}
        </button>
      </form>
    </main>
  )
}
