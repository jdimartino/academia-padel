import { NavLink, useParams } from 'react-router-dom'

/*
 * Links de navegación (Agenda / Alumnos / Profesores / Cobros / Reportes /
 * Configuración) compartidos por el sidebar de desktop y el menú bottom-sheet de
 * mobile. El tenant sale de la ruta (`/:academia/...`). "Reportes" es solo para
 * administradores (el rol se pasa por prop).
 */
export default function AppNav({ onNavigate, rol = null }) {
  const { academia } = useParams()
  const links = [
    { to: `/${academia}/agenda`, label: 'Agenda' },
    { to: `/${academia}/alumnos`, label: 'Alumnos' },
    { to: `/${academia}/profesores`, label: 'Profesores' },
    { to: `/${academia}/cobros`, label: 'Cobros' },
    ...(rol === 'administrador' ? [{ to: `/${academia}/reportes`, label: 'Reportes' }] : []),
    { to: `/${academia}/configuracion`, label: 'Configuración' },
  ]

  return (
    <nav className="nav-app" aria-label="Secciones">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) => `nav-app__link${isActive ? ' is-sel' : ''}`}
          onClick={onNavigate}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  )
}
