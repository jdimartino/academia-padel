import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import AppNav from './AppNav'
import Background from './Background'
import EstadoMensaje from './EstadoMensaje'
import MenuMovil from './MenuMovil'
import { LogoMark, MenuIcon } from './Icons'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { getMiMembresia } from '../firebase/db'
import useMediaQuery from '../hooks/useMediaQuery'

/*
 * Marco de las pantallas de fichas (Alumnos / Profesores): sidebar con
 * navegación en desktop, header con menú bottom-sheet en mobile. En ambos
 * casos valida primero que sea administrador activo (única lectura permitida a
 * un no-admin: su propia membresía) antes de montar la pantalla.
 */
export default function PageChrome({ titulo, children }) {
  const { academia } = useParams()
  const { user } = useAuth()
  const esDesktop = useMediaQuery('(min-width: 1024px)')
  const [estado, setEstado] = useState({ cargando: true, rol: null })
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    let activo = true
    getMiMembresia(db, academia, user.uid)
      .then((membresia) => {
        if (activo) setEstado({ cargando: false, rol: membresia?.rol ?? null })
      })
      .catch(() => {
        if (activo) setEstado({ cargando: false, rol: null })
      })
    return () => {
      activo = false
    }
  }, [academia, user.uid])

  if (estado.cargando) return <EstadoMensaje titulo="Cargando…" />

  if (estado.rol !== 'administrador') {
    return <EstadoMensaje titulo="Esta cuenta no tiene acceso a esta academia" />
  }

  if (esDesktop) {
    return (
      <div className="app">
        <Background />
        <div className="shell">
          <aside className="sidebar glass">
            <div className="sidebar__marca">
              <LogoMark />
              <span className="sidebar__titulo">Academia Pádel</span>
            </div>
            <AppNav />
          </aside>
          <main className="main">
            <header className="main__header">
              <div>
                <p className="eyebrow">Academia</p>
                <h1 className="main__fecha">{titulo}</h1>
              </div>
            </header>
            {children}
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="app app--mobile">
      <Background />
      <header className="p-header">
        <div className="m-marca">
          <LogoMark size={28} />
          <span className="m-marca__texto">{titulo}</span>
        </div>
        <button type="button" className="icon-btn" aria-label="Abrir menú" onClick={() => setMenu(true)}>
          <MenuIcon />
        </button>
      </header>
      {children}
      {menu ? <MenuMovil onClose={() => setMenu(false)} /> : null}
    </div>
  )
}
