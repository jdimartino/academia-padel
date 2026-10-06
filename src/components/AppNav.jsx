import { NavLink, useParams } from 'react-router-dom'

/*
 * Links de navegación (Agenda / Alumnos / Profesores / Configuración)
 * compartidos por el sidebar de desktop y el menú bottom-sheet de mobile. El
 * tenant sale de la ruta (`/:academia/...`).
 */
export default function AppNav({ onNavigate }) {
  const { academia } = useParams()
  const links = [
    { to: `/${academia}/agenda`, label: 'Agenda' },
    { to: `/${academia}/alumnos`, label: 'Alumnos' },
    { to: `/${academia}/profesores`, label: 'Profesores' },
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
