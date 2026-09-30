import { useAuth } from '../context/AuthContext'

export default function Dashboard() {
  const { user, logout } = useAuth()

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
      <p>Las sedes, canchas, profesores, clases, asistencia y facturación se suman acá.</p>
    </main>
  )
}
