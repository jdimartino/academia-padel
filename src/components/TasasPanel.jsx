import { useState } from 'react'
import { useAvisos } from '../context/AvisosContext'
import { useTasas } from '../context/TasasContext'
import { formatearFechaLarga, formatearFechaHora } from '../lib/fechas'
import { etiquetaFuente, formatearBs, formatearEur, momentoDeTasa } from '../lib/tasas'

/** EUR por USD implícito en las dos tasas (Bs/USD ÷ Bs/EUR). */
function eurosPorDolar(tasas) {
  if (!tasas || !tasas.bsPorEur) return null
  return tasas.bsPorUsd / tasas.bsPorEur
}

/**
 * Panel de la tasa BCV: 1 USD en Bs y en EUR, fecha y fuente, más el aviso de
 * "tasa desactualizada". Con `permiteEditar` (solo Configuración, pantalla de
 * admin) suma el override manual y el botón de volver a la automática.
 */
export default function TasasPanel({ permiteEditar = false }) {
  const { tasas, cargando, fuente, vencida, guardarManual, restaurarAutomatica, refrescar } = useTasas()
  const { mostrarExito, mostrarError, mostrarErrorTecnico } = useAvisos()
  const [bsUsd, setBsUsd] = useState('')
  const [bsEur, setBsEur] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [actualizando, setActualizando] = useState(false)
  const [tasaVista, setTasaVista] = useState(null)

  // Sincroniza los inputs cuando llega o cambia la tasa (ajuste en render, sin
  // efecto): conserva lo que el admin está tipeando hasta que la tasa cambie.
  if (tasas && tasas !== tasaVista) {
    setTasaVista(tasas)
    setBsUsd(String(tasas.bsPorUsd))
    setBsEur(String(tasas.bsPorEur))
  }

  async function guardar(evento) {
    evento.preventDefault()
    const usd = Number(String(bsUsd).replace(',', '.'))
    const eur = Number(String(bsEur).replace(',', '.'))
    if (!(usd > 0) || !(eur > 0)) {
      mostrarError('Las tasas deben ser números mayores a 0.')
      return
    }
    setGuardando(true)
    try {
      await guardarManual(usd, eur)
      mostrarExito('Tasa manual guardada')
    } catch (err) {
      mostrarErrorTecnico('guardar-tasa', err)
    } finally {
      setGuardando(false)
    }
  }

  async function restaurar() {
    setGuardando(true)
    try {
      const normalizado = await restaurarAutomatica()
      if (normalizado) mostrarExito('Tasa automática restaurada')
      else mostrarError('La API de tasas no respondió. Se conserva la tasa actual.')
    } catch (err) {
      mostrarErrorTecnico('restaurar-tasa', err)
    } finally {
      setGuardando(false)
    }
  }

  /*
   * "Actualizar": fuerza una consulta fresca saltando el caché (por si la tasa
   * del día cambió). Si la API/red falla, se conserva la tasa que ya se ve y se
   * muestra un error corto.
   */
  async function actualizar() {
    setActualizando(true)
    try {
      const ok = await refrescar()
      if (!ok) mostrarError('No se pudo actualizar la tasa. Se mantiene la actual.')
    } finally {
      setActualizando(false)
    }
  }

  const eur = eurosPorDolar(tasas)
  const momento = momentoDeTasa(tasas)
  // Fecha del valor BCV y, si se conoce, la hora en que se obtuvo la tasa.
  const fechaTexto = tasas?.fecha ? formatearFechaLarga(tasas.fecha) : null
  const horaTexto = momento ? formatearFechaHora(momento).split(', ')[1] ?? null : null

  /*
   * Vista COMPACTA (pantallas que solo muestran la tasa, como Cobros y Reportes):
   * una sola franja horizontal con los dos valores, fecha + hora + fuente, el
   * aviso de tasa desactualizada y el botón "Actualizar". La versión editable de
   * Configuración conserva el panel completo con su formulario.
   */
  if (!permiteEditar) {
    return (
      <section className="tasas-strip glass" aria-label="Tasas BCV">
        <span className="tasas-strip__titulo">Tasa BCV</span>
        {cargando && !tasas ? (
          <span className="tasas-strip__meta">Consultando…</span>
        ) : tasas ? (
          <>
            <span className="tasas-strip__valor">
              1 USD = <strong>{formatearBs(tasas.bsPorUsd)}</strong>
            </span>
            <span className="tasas-strip__valor">
              1 USD = <strong>{formatearEur(eur)}</strong>
            </span>
            <span className="tasas-strip__meta">
              {fechaTexto ? `${fechaTexto}${horaTexto ? ` · ${horaTexto}` : ''} · ` : ''}
              {etiquetaFuente(fuente ?? tasas.fuente)}
            </span>
            {vencida ? (
              <span className="tasas__badge" role="status">
                Desactualizada
              </span>
            ) : null}
          </>
        ) : (
          <span className="tasas-strip__meta">Sin tasa disponible · montos en USD</span>
        )}
        <button
          type="button"
          className="btn btn--secondary tasas-strip__btn"
          disabled={actualizando || cargando}
          onClick={actualizar}
        >
          {actualizando ? 'Actualizando…' : 'Actualizar'}
        </button>
      </section>
    )
  }

  return (
    <section className="detalle glass tasas" aria-label="Tasas BCV">
      <div className="lista-sedes__cab">
        <h2 className="lista-sedes__titulo">Tasas BCV</h2>
        {vencida && tasas ? (
          <span className="tasas__badge" role="status">
            Tasa desactualizada
          </span>
        ) : null}
      </div>

      {cargando && !tasas ? <p className="parametros__hint">Consultando tasas…</p> : null}

      {tasas ? (
        <div className="tasas__valores">
          <div className="tasas__valor">
            <span className="tasas__label">1 USD</span>
            <span className="tasas__monto">{formatearBs(tasas.bsPorUsd)}</span>
          </div>
          <div className="tasas__valor">
            <span className="tasas__label">1 USD</span>
            <span className="tasas__monto">{formatearEur(eur)}</span>
          </div>
          <p className="tasas__meta">
            {fechaTexto ? `Actualizada ${fechaTexto}${horaTexto ? ` · ${horaTexto}` : ''} · ` : ''}
            Fuente: {etiquetaFuente(fuente ?? tasas.fuente)}
          </p>
        </div>
      ) : !cargando ? (
        <p className="parametros__hint">
          No hay tasa disponible (la API y el respaldo fallaron). Los montos se muestran en USD.
        </p>
      ) : null}

      {permiteEditar ? (
        <form className="tasas__form" onSubmit={guardar}>
          <label className="parametros__campo">
            <span className="form__label">Bs por USD</span>
            <input
              className="form__input"
              type="text"
              inputMode="decimal"
              value={bsUsd}
              onChange={(e) => setBsUsd(e.target.value)}
              aria-label="Bs por USD"
            />
          </label>
          <label className="parametros__campo">
            <span className="form__label">Bs por EUR</span>
            <input
              className="form__input"
              type="text"
              inputMode="decimal"
              value={bsEur}
              onChange={(e) => setBsEur(e.target.value)}
              aria-label="Bs por EUR"
            />
          </label>
          <div className="tasas__acciones">
            <button type="submit" className="btn-cta" disabled={guardando}>
              Guardar manual
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={guardando}
              onClick={restaurar}
            >
              Usar automática
            </button>
          </div>
          <span className="parametros__hint">
            La tasa manual se guarda para esta academia y no se pisa con la de la API.
          </span>
        </form>
      ) : null}
    </section>
  )
}
