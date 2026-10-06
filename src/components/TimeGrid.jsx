import { useMemo } from 'react'
import ClassBlock from './ClassBlock'
import { formatHora12, horasDeFranja, lineasDeFranja, rangoHorasAgenda } from '../lib/agenda'

export default function TimeGrid({ sede, canchas, clases, escala, onSelect }) {
  /*
   * Rango vertical de la grilla: sale del horario de la sede SELECCIONADA
   * (`sede.horario`, con el default 07-23 si falta) y se agranda para incluir
   * cualquier clase no cancelada que quede fuera, así una clase guardada nunca
   * se dibuja fuera de la grilla (ver `rangoHorasAgenda`). Se recalcula al
   * cambiar de sede o de día/semana. Ya no es la franja fija 07-21.
   */
  const rango = useMemo(() => rangoHorasAgenda(sede?.horario, clases), [sede, clases])
  const minutoInicio = rango.horaInicio * 60
  const alto = (rango.horaFin - rango.horaInicio) * 60 * escala
  const lineas = lineasDeFranja(rango)
  const horas = horasDeFranja(rango)

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
                style={{ top: `${(h * 60 - minutoInicio) * escala}px` }}
              >
                {formatHora12(h)}
              </span>
            ))}
          </div>

          {canchas.map((cancha) => (
            <div className="grid__col" key={cancha.id} style={{ height: `${alto}px` }}>
              {lineas.map((linea) => (
                <span
                  key={linea.minuto}
                  className={`grid__linea${linea.horaEntera ? ' is-hora' : ''}`}
                  style={{ top: `${(linea.minuto - minutoInicio) * escala}px` }}
                />
              ))}
              {clases
                .filter((c) => c.canchaId === cancha.id)
                .map((clase) => (
                  <ClassBlock
                    key={clase.id}
                    clase={clase}
                    escala={escala}
                    minutoInicio={minutoInicio}
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
