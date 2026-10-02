import TimeGrid from './TimeGrid'
import { LogoMark } from './Icons'
import { DIAS_CORTOS, diasDeSemana, formatearFechaLarga } from '../lib/fechas'

export default function AgendaMobile({
  sedes,
  sede,
  onSede,
  fecha,
  hoy,
  onSeleccionarFecha,
  canchas,
  canchaId,
  onCancha,
  clases,
  totalClases,
  onSelectClase,
}) {
  const semana = diasDeSemana(fecha)
  const canchaSel = canchas.find((c) => c.id === canchaId) ?? canchas[0]

  return (
    <>
      <header className="m-header">
        <div className="m-marca">
          <LogoMark size={28} />
          <span className="m-marca__texto">Agenda · {sede?.nombre ?? ''}</span>
        </div>
        <h1 className="m-fecha">{formatearFechaLarga(fecha)}</h1>
      </header>

      <div className="chips-row" role="group" aria-label="Sedes">
        {sedes.map((s) => (
          <button
            type="button"
            key={s.id}
            className={`chip-sede${s.id === sede?.id ? ' is-sel' : ''}`}
            aria-pressed={s.id === sede?.id}
            onClick={() => onSede(s.id)}
          >
            {s.nombre}
          </button>
        ))}
      </div>

      <div className="semana glass" role="group" aria-label="Semana">
        {semana.map((iso, i) => {
          const clasesBoton = [
            'semana__dia',
            iso === hoy ? 'is-hoy' : '',
            iso === fecha ? 'is-sel' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              type="button"
              key={iso}
              className={clasesBoton}
              aria-label={iso}
              aria-pressed={iso === fecha}
              onClick={() => onSeleccionarFecha(iso)}
            >
              <span className="semana__letra">{DIAS_CORTOS[i]}</span>
              <span className="semana__numero">{Number(iso.slice(8, 10))}</span>
            </button>
          )
        })}
      </div>

      <div className="chips-row chips-row--canchas" role="group" aria-label="Canchas">
        {canchas.map((cancha) => {
          const n = clases.filter((c) => c.canchaId === cancha.id).length
          return (
            <button
              type="button"
              key={cancha.id}
              className={`chip-cancha${cancha.id === canchaSel?.id ? ' is-sel' : ''}`}
              aria-pressed={cancha.id === canchaSel?.id}
              onClick={() => onCancha(cancha.id)}
            >
              {cancha.nombre} · {n}
            </button>
          )
        })}
      </div>

      <div className="m-grid">
        {canchaSel ? (
          <TimeGrid
            canchas={[canchaSel]}
            clases={clases}
            escala={1.1}
            onSelect={onSelectClase}
          />
        ) : null}
      </div>

      <div className="m-bar glass-strong">
        <div className="m-bar__info">
          <strong>
            {totalClases} {totalClases === 1 ? 'clase' : 'clases'}
          </strong>
          <span>
            {canchaSel?.nombre ?? ''} · {sede?.nombre ?? ''}
          </span>
        </div>
        <button type="button" className="btn-cta" disabled title="Disponible próximamente">
          Nueva reserva
        </button>
      </div>
    </>
  )
}
