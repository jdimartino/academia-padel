import { ChevronLeft, ChevronRight } from './Icons'
import { DIAS_CORTOS, nombreMes, semanasDelMes } from '../lib/fechas'

export default function MiniCalendar({ mes, fecha, hoy, onSeleccionar, onCambiarMes }) {
  const dias = semanasDelMes(mes)

  return (
    <div className="minical">
      <div className="minical__head">
        <span className="minical__mes">{nombreMes(mes)}</span>
        <div className="minical__nav">
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label="Mes anterior"
            onClick={() => onCambiarMes(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label="Mes siguiente"
            onClick={() => onCambiarMes(1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="minical__semana">
        {DIAS_CORTOS.map((dia) => (
          <span key={dia} className="minical__dow">
            {dia}
          </span>
        ))}
      </div>

      <div className="minical__grid">
        {dias.map((iso) => {
          const clases = [
            'minical__dia',
            iso.slice(0, 7) !== mes.slice(0, 7) ? 'is-otro-mes' : '',
            iso === hoy ? 'is-hoy' : '',
            iso === fecha ? 'is-sel' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              type="button"
              key={iso}
              className={clases}
              aria-label={iso}
              aria-pressed={iso === fecha}
              onClick={() => onSeleccionar(iso)}
            >
              {Number(iso.slice(8, 10))}
            </button>
          )
        })}
      </div>
    </div>
  )
}
