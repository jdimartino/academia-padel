import { useMemo } from 'react'
import ClassBlock from './ClassBlock'
import {
  esHuecoReservable,
  formatHora12,
  horarioDeSede,
  horasDeFranja,
  huecoDeClic,
  huecoLibre,
  lineasDeFranja,
  opcionesDeInicio,
  rangoHorasAgenda,
} from '../lib/agenda'

/*
 * `onSelectHueco` es opcional: sin él (o sin `fecha`) la grilla es solo de
 * lectura. Con él, cada hora LIBRE de cada cancha activa es una celda
 * enfocable que abre el formulario de reserva prellenado.
 */
export default function TimeGrid({
  sede,
  canchas,
  clases,
  fecha,
  escala,
  onSelect,
  onSelectHueco = null,
}) {
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

  // Solo son clicables las horas de inicio que admite una reserva de 1 h en la
  // sede: la última hora del rango es el borde de cierre y no admite clase.
  const horasReservables = useMemo(
    () => new Set(opcionesDeInicio(60, horarioDeSede(sede))),
    [sede],
  )

  /*
   * El clic puede caer en cualquier punto de la celda: se le pasan a
   * `huecoDeClic` los minutos del clic dentro de la celda para que redondee
   * hacia abajo a la hora en punto.
   */
  function alClicHueco(event, canchaId, minutosDeLaCelda) {
    const offset = Number(event?.nativeEvent?.offsetY)
    // Tope de 59: el último píxel de la celda sigue siendo la misma hora.
    const dentro = Number.isFinite(offset) ? Math.min(Math.max(offset, 0) / escala, 59) : 0
    const hueco = huecoDeClic({
      canchaId,
      minutosDesdeInicioGrilla: minutosDeLaCelda + dentro,
      rango,
    })
    // El reloj se relee acá: si el hueco ya pasó, no pasa nada.
    if (!hueco || !esHuecoReservable(hueco, fecha)) return
    onSelectHueco(hueco)
  }

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
              {onSelectHueco && fecha && cancha.activa !== false
                ? horas
                    .filter((h) => h < rango.horaFin)
                    .map((h) => {
                      const desde = h * 60 - minutoInicio
                      const hueco = huecoDeClic({
                        canchaId: cancha.id,
                        minutosDesdeInicioGrilla: desde,
                        rango,
                      })
                      if (!hueco || !horasReservables.has(hueco.horaInicio)) return null
                      // Ocupada por una clase no cancelada, o ya pasada: sin celda.
                      if (!huecoLibre(clases, hueco) || !esHuecoReservable(hueco, fecha)) {
                        return null
                      }
                      return (
                        <button
                          key={`hueco-${cancha.id}-${h}`}
                          type="button"
                          className="grid__hueco"
                          style={{ top: `${desde * escala}px`, height: `${60 * escala}px` }}
                          aria-label={`Reservar ${cancha.nombre}, ${formatHora12(hueco.horaInicio)}`}
                          onClick={(event) => alClicHueco(event, cancha.id, desde)}
                        />
                      )
                    })
                : null}
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
