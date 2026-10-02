import { CloseIcon } from './Icons'
import { aHoraHHmm, estadoDe, rangoClase, tituloClase } from '../lib/agenda'
import { formatearFechaLarga } from '../lib/fechas'

function slotsDeClase(clase) {
  const rango = rangoClase(clase)
  if (!rango) return []
  const slots = []
  for (let m = rango.inicio; m < rango.fin; m += 30) slots.push(aHoraHHmm(m))
  return slots
}

export default function DetailSheet({ clase, canchas, sedeNombre, onClose }) {
  const estado = estadoDe(clase.estado)
  const cancha = canchas.find((c) => c.id === clase.canchaId)
  const alumnos = clase.alumnoNombres ?? []
  const cupo = clase.cupo ?? 0

  return (
    <aside className="sheet glass-strong" role="dialog" aria-label="Detalle de la clase">
      <header className="sheet__head">
        <span className={`badge badge--${estado.tono}`}>{estado.label.toUpperCase()}</span>
        <button type="button" className="icon-btn" aria-label="Cerrar detalle" onClick={onClose} autoFocus>
          <CloseIcon />
        </button>
      </header>

      <h2 className="sheet__titulo">{tituloClase(clase)}</h2>

      <dl className="sheet__datos">
        <div className="sheet__fila">
          <dt>Sede</dt>
          <dd>{clase.sedeNombre ?? sedeNombre}</dd>
        </div>
        <div className="sheet__fila">
          <dt>Cancha</dt>
          <dd>{cancha?.nombre ?? clase.canchaId}</dd>
        </div>
        <div className="sheet__fila">
          <dt>Fecha</dt>
          <dd>{formatearFechaLarga(clase.fecha)}</dd>
        </div>
        <div className="sheet__fila">
          <dt>Horario</dt>
          <dd>
            {clase.horaInicio}–{clase.horaFin}
          </dd>
        </div>
        <div className="sheet__fila">
          <dt>Profesor</dt>
          <dd>{clase.profesorNombre}</dd>
        </div>
        <div className="sheet__fila">
          <dt>Alumnos</dt>
          <dd>
            {alumnos.length} de {cupo}
          </dd>
        </div>
      </dl>

      <div className="sheet__slots">
        <h3 className="sheet__subtitulo">Bloques de 30 min</h3>
        <ul className="chips-slots">
          {slotsDeClase(clase).map((slot) => (
            <li key={slot} className="chip-slot">
              {slot}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
