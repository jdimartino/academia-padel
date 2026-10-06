import {
  estadoDe,
  estaSinCerrar,
  formatHora12,
  iniciales,
  rangoClase,
  tituloClase,
} from '../lib/agenda'

/*
 * `minutoInicio` es el primer minuto del rango que dibuja la grilla (el de la
 * sede seleccionada, ver `rangoHorasAgenda`): posiciona el bloque dentro de esa
 * franja, que ya no es fija.
 */
export default function ClassBlock({ clase, escala, minutoInicio, onSelect }) {
  const rango = rangoClase(clase)
  if (!rango) return null

  const estado = estadoDe(clase.estado)
  const alumnos = clase.alumnoNombres ?? []
  const sinCerrar = estaSinCerrar(clase)
  const top = (rango.inicio - minutoInicio) * escala
  const alto = (rango.fin - rango.inicio) * escala

  return (
    <button
      type="button"
      className={`bloque bloque--${estado.tono}${sinCerrar ? ' bloque--sin-cerrar' : ''}`}
      style={{ top: `${top}px`, height: `${alto}px` }}
      onClick={() => onSelect(clase)}
      aria-label={`${tituloClase(clase)}, ${formatHora12(clase.horaInicio)} a ${formatHora12(clase.horaFin)}, ${estado.label}${sinCerrar ? ', sin cerrar' : ''}`}
    >
      {sinCerrar ? (
        <span
          className="bloque__sin-cerrar"
          role="img"
          aria-label="Sin cerrar"
          title="Sin cerrar"
        />
      ) : null}
      <span className="bloque__hora">
        {formatHora12(clase.horaInicio)}–{formatHora12(clase.horaFin)}
      </span>
      <span className="bloque__estado">{estado.label.toUpperCase()}</span>
      <span className="bloque__titulo">{tituloClase(clase)}</span>
      <span className="bloque__profe">{clase.profesorNombre}</span>
      {alumnos.length ? (
        <span className="bloque__avatares">
          {alumnos.slice(0, 4).map((nombre, i) => (
            <span key={`${nombre}-${i}`} className="avatar" title={nombre}>
              {iniciales(nombre)}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  )
}
