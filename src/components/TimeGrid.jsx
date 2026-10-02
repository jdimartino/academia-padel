import ClassBlock from './ClassBlock'
import { DURACION_MIN, MIN_INICIO, horasDeFranja, lineasDeFranja } from '../lib/agenda'

export default function TimeGrid({ canchas, clases, escala, onSelect }) {
  const alto = DURACION_MIN * escala
  const lineas = lineasDeFranja()
  const horas = horasDeFranja()

  return (
    <section className="grid-panel glass" aria-label="Grilla horaria">
      <div className="grid-scroll">
        <div className="grid" style={{ '--ncanchas': canchas.length || 1 }}>
          <div className="grid__corner" />
          {canchas.map((cancha) => {
            const n = clases.filter((c) => c.canchaId === cancha.id).length
            return (
              <div className="grid__head" key={cancha.id}>
                <span className="grid__nombre">{cancha.nombre}</span>
                <span className="grid__cuenta">
                  {n} {n === 1 ? 'clase' : 'clases'}
                </span>
              </div>
            )
          })}

          <div className="grid__times" style={{ height: `${alto}px` }}>
            {horas.map((h) => (
              <span
                key={h}
                className="grid__hora"
                style={{ top: `${(h * 60 - MIN_INICIO) * escala}px` }}
              >
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>

          {canchas.map((cancha) => (
            <div className="grid__col" key={cancha.id} style={{ height: `${alto}px` }}>
              {lineas.map((linea) => (
                <span
                  key={linea.minuto}
                  className={`grid__linea${linea.horaEntera ? ' is-hora' : ''}`}
                  style={{ top: `${(linea.minuto - MIN_INICIO) * escala}px` }}
                />
              ))}
              {clases
                .filter((c) => c.canchaId === cancha.id)
                .map((clase) => (
                  <ClassBlock
                    key={clase.id}
                    clase={clase}
                    escala={escala}
                    onSelect={onSelect}
                  />
                ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
