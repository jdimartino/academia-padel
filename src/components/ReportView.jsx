import { useState } from 'react'
import MontoEquivalente from './MontoEquivalente'
import { etiquetaDia } from '../lib/agenda'
import { formatearFechaLarga, formatearFechaHora } from '../lib/fechas'
import { etiquetaFuente } from '../lib/tasas'
import { aCSV, descargarTexto, formatearCelda, urlWhatsApp } from '../lib/reportes'

/** Formatea una celda de la tabla según el tipo de columna. */
function Celda({ columna, valor, tasas }) {
  if (columna.tipo === 'money') {
    return <MontoEquivalente cents={Number(valor) || 0} tasas={tasas} />
  }
  if (columna.tipo === 'fecha') {
    return valor ? formatearFechaLarga(valor) : '—'
  }
  if (columna.tipo === 'dia') {
    return valor === '' || valor === null ? '—' : etiquetaDia(valor)
  }
  return valor === '' || valor === null || valor === undefined ? '—' : String(valor)
}

/**
 * Vista compartida de TODOS los informes: encabezado imprimible (academia,
 * título, filtros aplicados, fecha/hora y tasa BCV usada), tarjetas de resumen,
 * tabla con fila de totales y barra de exportación (PDF por impresión, WhatsApp,
 * Compartir nativo y CSV para Excel).
 */
export default function ReportView({
  academia = 'Academia',
  titulo,
  descripcion,
  filtrosTexto = '',
  columnas = [],
  filas = [],
  totales = null,
  resumen = [],
  tasas = null,
  fuente = null,
  textoCompartir = '',
  telefono = null,
  nombreArchivo = 'informe',
  children,
  onRefrescar,
}) {
  const [exportando, setExportando] = useState(false)
  // Fecha/hora de generación fijada al montar (no se recalcula en cada render).
  const [generadoEn] = useState(() => formatearFechaHora(new Date()))

  const puedeCompartir = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const rango = filtrosTexto
  const eurTexto = tasas ? `1 USD = ${tasas.bsPorUsd} Bs` : 'sin tasa'

  function exportarCSV() {
    const filasCSV = filas.map((fila) => {
      const salida = {}
      for (const col of columnas) salida[col.clave] = formatearCelda(fila[col.clave], col.tipo)
      return salida
    })
    descargarTexto(`${nombreArchivo}.csv`, aCSV(columnas, filasCSV))
  }

  async function compartir() {
    setExportando(true)
    try {
      await navigator.share({ title: titulo, text: textoCompartir })
    } catch {
      // El usuario canceló o el navegador no pudo: sin ruido.
    } finally {
      setExportando(false)
    }
  }

  function abrirWhatsApp() {
    window.open(urlWhatsApp(textoCompartir, telefono), '_blank', 'noopener')
  }

  return (
    <section className="reporte">
      <header className="reporte__cab glass">
        <div className="reporte__titulo-bloque">
          <p className="reporte__academia">{academia}</p>
          <h2 className="reporte__titulo">{titulo}</h2>
          {descripcion ? <p className="reporte__descripcion">{descripcion}</p> : null}
          <p className="reporte__meta">
            {rango ? `${rango} · ` : ''}
            Generado {generadoEn} · {eurTexto}
            {fuente ? ` · ${etiquetaFuente(fuente)}` : ''}
          </p>
        </div>
        <div className="reporte__acciones">
          <button type="button" className="btn btn--secondary" onClick={() => window.print()}>
            PDF
          </button>
          <button type="button" className="btn btn--secondary" onClick={abrirWhatsApp}>
            WhatsApp
          </button>
          {puedeCompartir ? (
            <button type="button" className="btn btn--secondary" disabled={exportando} onClick={compartir}>
              Compartir
            </button>
          ) : null}
          <button type="button" className="btn btn--secondary" onClick={exportarCSV}>
            CSV
          </button>
          {onRefrescar ? (
            <button type="button" className="btn-cta" onClick={onRefrescar}>
              Actualizar
            </button>
          ) : null}
        </div>
      </header>

      {children}

      {resumen.length > 0 ? (
        <div className="reporte__resumen">
          {resumen.map((item) => (
            <div key={item.label} className="reporte__tarjeta glass">
              <span className="reporte__tarjeta-label">{item.label}</span>
              <span className="reporte__tarjeta-valor">
                {item.tipo === 'money' ? (
                  <MontoEquivalente cents={item.valor} tasas={tasas} />
                ) : (
                  item.valor
                )}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {columnas.length > 0 ? (
        filas.length === 0 ? (
          <p className="parametros__hint">Sin datos para el rango y los filtros elegidos.</p>
        ) : (
          <div className="reporte__tabla-wrap glass">
            <table className="tabla-comp reporte__tabla">
              <thead>
                <tr>
                  {columnas.map((col) => (
                    <th
                      key={col.clave}
                      scope="col"
                      className={col.tipo === 'money' || col.tipo === 'numero' ? 'tabla-comp__monto-col' : ''}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((fila, i) => (
                  <tr key={fila.id ?? i}>
                    {columnas.map((col) => (
                      <td
                        key={col.clave}
                        data-label={col.label}
                        className={col.tipo === 'money' || col.tipo === 'numero' ? 'tabla-comp__monto-col' : ''}
                      >
                        <Celda columna={col} valor={fila[col.clave]} tasas={tasas} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {totales && totales.valor != null ? (
                <tfoot>
                  <tr>
                    {columnas.map((col) => {
                      if (col.clave === totales.clave) {
                        return (
                          <td key={col.clave} className="reporte__total">
                            {totales.tipo === 'money' ? (
                              <MontoEquivalente cents={totales.valor} tasas={tasas} />
                            ) : (
                              totales.valor
                            )}
                          </td>
                        )
                      }
                      if (col === columnas[0]) {
                        return (
                          <td key={col.clave} className="reporte__total-label">
                            Total
                          </td>
                        )
                      }
                      return <td key={col.clave} />
                    })}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )
      ) : null}
    </section>
  )
}
