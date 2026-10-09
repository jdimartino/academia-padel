import { useMemo } from 'react'
import ClassBlock from './ClassBlock'
import {
  MINUTOS_BLOQUE,
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
 * lectura. Con él, cada bloque LIBRE de MINUTOS_BLOQUE (30) minutos de cada
 * cancha activa es una celda enfocable que abre el formulario de reserva
 * prellenado.
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
  // Etiquetas: solo las horas en punto; las medias horas son líneas finas.
  const horas = horasDeFranja(rango)

  /*
   * Bloques de inicio que admite una reserva de 1 h en la sede: la última hora
   * del rango es el borde de cierre y no admite clase. Es una lista de "HH:mm"
   * cada MINUTOS_BLOQUE, no solo horas en punto.
   */
  const iniciosReservables = useMemo(
    () => new Set(opcionesDeInicio(60, horarioDeSede(sede))),
    [sede],
  )

  /*
   * Las celdas de hueco libre son de 30 minutos: se arman desde las líneas de la
   * franja (que ya vienen cada MINUTOS_BLOQUE) y no desde las horas enteras, así
   * la media hora también es clicable.
   */
  const bloquesDeGrilla = useMemo(
    () =>
      lineas
        .filter((linea) => linea.minuto < rango.horaFin * 60)
        .map((linea) => {
          const desde = linea.minuto - minutoInicio
          const hueco = huecoDeClic({
            canchaId: null,
            minutosDesdeInicioGrilla: desde,
            rango,
          })
          return { desde, horaInicio: hueco?.horaInicio ?? null }
        })
        .filter((bloque) => bloque.horaInicio !== null),
    [lineas, minutoInicio, rango],
  )

  /*
   * El clic puede caer en cualquier punto de la celda: se le pasan a
   * `huecoDeClic` los minutos del clic dentro de la celda para que redondee
   * hacia abajo al bloque de 30 min.
   */
  function alClicHueco(event, canchaId, minutosDeLaCelda) {
    const offset = Number(event?.nativeEvent?.offsetY)
    // Tope de MINUTOS_BLOQUE - 1: el último píxel de la celda sigue siendo el
    // mismo bloque.
    const dentro = Number.isFinite(offset)
      ? Math.min(Math.max(offset, 0) / escala, MINUTOS_BLOQUE - 1)
      : 0
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
                ? bloquesDeGrilla.map((bloque) => {
                    const hueco = { canchaId: cancha.id, horaInicio: bloque.horaInicio }
                    if (!iniciosReservables.has(hueco.horaInicio)) return null
                    // Ocupada por una clase no cancelada, o ya pasada: sin celda.
                    if (!huecoLibre(clases, hueco) || !esHuecoReservable(hueco, fecha)) {
                      return null
                    }
                    return (
                      <button
                        key={`hueco-${cancha.id}-${bloque.horaInicio}`}
                        type="button"
                        className="grid__hueco"
                        style={{
                          top: `${bloque.desde * escala}px`,
                          height: `${MINUTOS_BLOQUE * escala}px`,
                        }}
                        aria-label={`Reservar ${cancha.nombre}, ${formatHora12(hueco.horaInicio)}`}
                        onClick={(event) => alClicHueco(event, cancha.id, bloque.desde)}
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
