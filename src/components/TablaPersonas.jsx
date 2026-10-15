/*
 * Tabla compacta y responsive reutilizable (Alumnos / Profesores, y la base de
 * los reportes). Desktop: una fila por persona con columnas alineadas. Mobile:
 * cada fila se apila como una ficha con etiqueta + valor (mobile-first, sin
 * anchos fijos). El encabezado trae el buscador, el filtro de estado y el botón
 * "Nuevo" cuando se los pasa el llamador.
 *
 * `columnas` es una lista de `{ id, label, render(fila), className }`; la fila
 * se identifica por `clave(fila)`.
 */
export default function TablaPersonas({
  columnas,
  filas,
  clave = (fila) => fila.id,
  onFila,
  cargando = false,
  vacio = 'Sin resultados.',
  textoBusqueda,
  onBuscar,
  placeholderBusqueda = 'Buscar',
  sinResultados = 'No hay coincidencias.',
  estados,
  estadoValor,
  onEstado,
  onNuevo,
  etiquetaNuevo,
  contador,
  cargandoMas = false,
  hayMas = false,
  onCargarMas,
}) {
  const conBusqueda = typeof onBuscar === 'function'
  const buscando = conBusqueda && String(textoBusqueda ?? '').trim().length > 0

  return (
    <div className="fichas">
      <div className="fichas__barra">
        {conBusqueda ? (
          <input
            className="form__input"
            type="search"
            value={textoBusqueda}
            placeholder={placeholderBusqueda}
            aria-label={placeholderBusqueda}
            onChange={(evento) => onBuscar(evento.target.value)}
          />
        ) : null}
        {onNuevo ? (
          <button type="button" className="btn-cta" onClick={onNuevo}>
            {etiquetaNuevo}
          </button>
        ) : null}
      </div>

      {estados?.length ? (
        <div className="seg" role="group" aria-label="Filtrar por estado">
          {estados.map((opcion) => (
            <button
              key={opcion.valor}
              type="button"
              className={`seg__op${estadoValor === opcion.valor ? ' is-sel' : ''}`}
              aria-pressed={estadoValor === opcion.valor}
              onClick={() => onEstado?.(opcion.valor)}
            >
              {opcion.label}
            </button>
          ))}
        </div>
      ) : null}

      {contador ? <span className="fichas__contador">{contador}</span> : null}

      {cargando ? (
        <p className="aviso glass">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="aviso glass">{buscando ? sinResultados : vacio}</p>
      ) : (
        <table className="tabla-comp">
          <thead>
            <tr>
              {columnas.map((col) => (
                <th key={col.id} scope="col" className={col.className ?? ''}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr
                key={clave(fila)}
                className={onFila ? 'tabla-comp__fila--clic' : undefined}
                onClick={onFila ? () => onFila(fila) : undefined}
                tabIndex={onFila ? 0 : undefined}
                onKeyDown={
                  onFila
                    ? (evento) => {
                        if (evento.key === 'Enter' || evento.key === ' ') {
                          evento.preventDefault()
                          onFila(fila)
                        }
                      }
                    : undefined
                }
              >
                {columnas.map((col) => (
                  <td key={col.id} data-label={col.label} className={col.className ?? ''}>
                    {col.render(fila)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {hayMas ? (
        <button type="button" className="pill" disabled={cargandoMas} onClick={onCargarMas}>
          {cargandoMas ? 'Cargando…' : 'Cargar más'}
        </button>
      ) : null}
    </div>
  )
}
