import AppNav from './AppNav'
import MiniCalendar from './MiniCalendar'
import { LogoMark } from './Icons'

const LEYENDA = [
  { tono: 'reservada', label: 'Reservada' },
  { tono: 'ejecutada', label: 'Ejecutada' },
  { tono: 'pendiente', label: 'Pendiente de cobro' },
  { tono: 'cancelada', label: 'Cancelada' },
]

export default function Sidebar({
  sedes,
  sedeId,
  onSede,
  mes,
  fecha,
  hoy,
  onSeleccionarFecha,
  onCambiarMes,
  puedeReservar,
  onNuevaReserva,
}) {
  return (
    <aside className="sidebar glass">
      <div className="sidebar__marca">
        <LogoMark />
        <span className="sidebar__titulo">Academia Pádel</span>
      </div>

      <AppNav />

      {puedeReservar ? (
        <button type="button" className="btn-cta" onClick={onNuevaReserva}>
          Nueva reserva
        </button>
      ) : null}

      <MiniCalendar
        mes={mes}
        fecha={fecha}
        hoy={hoy}
        onSeleccionar={onSeleccionarFecha}
        onCambiarMes={onCambiarMes}
      />

      <nav className="sidebar__seccion" aria-label="Sedes">
        <h2 className="sidebar__label">Sedes</h2>
        <ul className="sedes">
          {sedes.map((sede) => (
            <li key={sede.id}>
              <button
                type="button"
                className={`sede${sede.id === sedeId ? ' is-sel' : ''}`}
                aria-pressed={sede.id === sedeId}
                onClick={() => onSede(sede.id)}
              >
                <span className="sede__nombre">{sede.nombre}</span>
                <span className="sede__meta">{sede.canchas.length} canchas</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar__seccion">
        <h2 className="sidebar__label">Estados</h2>
        <ul className="leyenda">
          {LEYENDA.map((item) => (
            <li key={item.tono} className="leyenda__item">
              <span className={`swatch swatch--${item.tono}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
