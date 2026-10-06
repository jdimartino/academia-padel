import AppNav from './AppNav'
import useCierreSeguro from '../hooks/useCierreSeguro'
import { CloseIcon } from './Icons'

/*
 * Menú de navegación para mobile: bottom sheet de vidrio con los mismos links
 * del sidebar. Se cierra al tocar el fondo, con Escape o un link. No hay datos
 * que perder, así que el cierre seguro es directo (sin confirmación).
 * Sin window.confirm/alert.
 */
export default function MenuMovil({ onClose }) {
  useCierreSeguro({ sucio: false, onCerrar: onClose })

  return (
    <div className="menu-overlay" role="presentation" onClick={onClose}>
      <nav
        className="menu-sheet glass-strong"
        role="dialog"
        aria-label="Menú"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="menu-sheet__head">
          <span className="sheet__subtitulo">Menú</span>
          <button type="button" className="icon-btn" aria-label="Cerrar menú" onClick={onClose} autoFocus>
            <CloseIcon />
          </button>
        </div>
        <AppNav onNavigate={onClose} />
      </nav>
    </div>
  )
}
