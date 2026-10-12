import { useEffect, useRef, useState } from 'react'
import { MoreIcon } from './Icons'

/*
 * Botón "⋯" con un menú de acciones (desactivar/reactivar, renombrar…). El menú
 * va anclado al botón (nunca fixed, para no romper el scroll del celular) y se
 * cierra con Escape, al elegir una acción o al tocar fuera. Compartido por la
 * pantalla de Configuración (sedes y cobros).
 */
export default function MenuAcciones({ etiqueta, items = [] }) {
  const [abierto, setAbierto] = useState(false)
  const contenedorRef = useRef(null)

  useEffect(() => {
    if (!abierto) return undefined
    function alTeclear(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setAbierto(false)
      }
    }
    function alApuntar(event) {
      if (!contenedorRef.current?.contains(event.target)) setAbierto(false)
    }
    window.addEventListener('keydown', alTeclear, true)
    window.addEventListener('pointerdown', alApuntar)
    return () => {
      window.removeEventListener('keydown', alTeclear, true)
      window.removeEventListener('pointerdown', alApuntar)
    }
  }, [abierto])

  return (
    <div className="menu-ancla" ref={contenedorRef}>
      <button
        type="button"
        className="icon-btn"
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((valor) => !valor)}
      >
        <MoreIcon size={18} />
      </button>
      {abierto ? (
        <div className="menu-flotante glass-strong" role="menu" aria-label={etiqueta}>
          {items.map((item) => (
            <button
              key={item.clave ?? item.etiqueta}
              type="button"
              role="menuitem"
              className="menu-flotante__item"
              onClick={() => {
                setAbierto(false)
                item.onSelect()
              }}
            >
              {item.etiqueta}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
