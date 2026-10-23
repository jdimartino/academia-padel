import { useCallback, useEffect, useRef, useState } from 'react'

/** Elementos que pueden recibir foco dentro del diálogo (para atrapar el Tab). */
const FOCALIZABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Copia al portapapeles con respaldo para navegadores sin navigator.clipboard. */
function copiarAlPortapapeles(texto) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(texto)
  return new Promise((resolve, reject) => {
    try {
      const area = document.createElement('textarea')
      area.value = texto
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.top = '-1000px'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      if (ok) resolve()
      else reject(new Error('No se pudo copiar'))
    } catch (err) {
      reject(err)
    }
  })
}

/*
 * Diálogo de error / confirmación: vidrio, centrado sobre el fondo, por encima
 * de cualquier sheet (z-index propio en avisos.css). role="alertdialog" con
 * aria-modal, foco atrapado y devuelto al elemento que lo tenía antes.
 *
 * Se cierra con Aceptar/Seguir editando, con Enter, con Escape o con un clic en
 * el fondo. El Escape se captura en fase de captura sobre `window` para que
 * ningún sheet de abajo lo vea: cierra SOLO el diálogo.
 */
export default function DialogoAviso({ dialogo, onCerrar, onConfirmar }) {
  const refDialogo = useRef(null)
  const refEnfocado = useRef(null)
  const refPrevio = useRef(null)
  const [copiado, setCopiado] = useState(false)
  const esConfirmacion = dialogo.tipo === 'confirm'

  // Al abrir: guarda el foco anterior y enfoca el botón principal.
  useEffect(() => {
    refPrevio.current = document.activeElement
    refEnfocado.current?.focus()
    return () => {
      const previo = refPrevio.current
      if (previo && typeof previo.focus === 'function' && document.contains(previo)) {
        previo.focus()
      }
    }
  }, [])

  // El botón de copiar vuelve a su texto a los 2 s.
  useEffect(() => {
    if (!copiado) return undefined
    const timer = setTimeout(() => setCopiado(false), 2000)
    return () => clearTimeout(timer)
  }, [copiado])

  useEffect(() => {
    function alTeclear(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCerrar()
        return
      }
      if (event.key === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) {
        // Con el foco en un botón, Enter lo activa solo; si no, cierra.
        event.preventDefault()
        onCerrar()
        return
      }
      if (event.key !== 'Tab') return
      const focalizables = [...(refDialogo.current?.querySelectorAll(FOCALIZABLES) ?? [])]
      if (!focalizables.length) return
      const primero = focalizables[0]
      const ultimo = focalizables[focalizables.length - 1]
      const activo = document.activeElement
      const dentro = refDialogo.current?.contains(activo)
      if (event.shiftKey && (activo === primero || !dentro)) {
        event.preventDefault()
        ultimo.focus()
      } else if (!event.shiftKey && (activo === ultimo || !dentro)) {
        event.preventDefault()
        primero.focus()
      }
    }
    window.addEventListener('keydown', alTeclear, true)
    return () => window.removeEventListener('keydown', alTeclear, true)
  }, [onCerrar])

  const copiar = useCallback(async () => {
    try {
      await copiarAlPortapapeles(dialogo.referencia)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }, [dialogo.referencia])

  return (
    <div className="aviso-overlay" onClick={onCerrar}>
      <div
        className="aviso-dialog glass-strong"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="aviso-titulo"
        aria-describedby="aviso-mensaje"
        ref={refDialogo}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="aviso-dialog__titulo" id="aviso-titulo">
          {dialogo.titulo}
        </h2>
        <p className="aviso-dialog__mensaje" id="aviso-mensaje">
          {dialogo.mensaje}
        </p>

        {dialogo.referencia ? (
          <div className="aviso-dialog__tecnico">
            <p className="aviso-dialog__referencia">{dialogo.referencia}</p>
            <button
              type="button"
              className="btn btn--secondary aviso-dialog__copiar"
              onClick={copiar}
            >
              {copiado ? 'Copiado' : 'Copiar referencia'}
            </button>
          </div>
        ) : null}

        {esConfirmacion ? (
          <div className="aviso-dialog__acciones">
            <button type="button" className="btn" ref={refEnfocado} onClick={onCerrar}>
              {dialogo.textoCancelar}
            </button>
            <button type="button" className="btn btn--secondary" onClick={onConfirmar}>
              {dialogo.textoConfirmar}
            </button>
          </div>
        ) : (
          <button type="button" className="btn" ref={refEnfocado} onClick={onCerrar}>
            Aceptar
          </button>
        )}
      </div>
    </div>
  )
}
