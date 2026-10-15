/*
 * Barra de progreso global (Parte 1.3): una franja fina arriba de todo que
 * aparece SOLO si la carga de datos tarda más de RETRASO_CARGA_MS.
 *
 * El retraso se hace con CSS (el class `is-visible` difiere la transición de
 * opacidad), así no hay un efecto con setState ni parpadeo en cargas cortas.
 * Es puramente informativa: no bloquea la interfaz ni roba el foco.
 */
export default function BarraProgreso({ activo }) {
  return (
    <div
      className={`barra-progreso${activo ? ' is-visible' : ''}`}
      role="progressbar"
      aria-label="Cargando"
      aria-hidden={!activo}
    >
      <span className="barra-progreso__pista" />
    </div>
  )
}
