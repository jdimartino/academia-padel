import useAccion from '../hooks/useAccion'
import { TEXTO_EXITO_BOTON, TEXTO_OCUPADO } from '../lib/accion'

/*
 * BotonAccion: botón con feedback de ocupado del uso compartido (Parte 1).
 *
 * Dos formas de usarlo:
 * - Autónomo: se le pasa `onClick` (async) y él ejecuta con su propio
 *   `useAccion` (disable inmediato, spinner con retraso, "Guardado ✓").
 * - Controlado: se le pasa `control` (el resultado de `useAccion()` del padre,
 *   p. ej. en un formulario que maneja su onSubmit).
 *
 * El ancho se mantiene estable: la etiqueta base reserva el espacio y el estado
 * de ocupado/éxito se superpone centrado, sin reflow.
 */
export default function BotonAccion({
  children,
  onClick,
  control,
  type = 'button',
  accion = 'accion',
  exito: mensajeExito = null,
  sinExito = false,
  inmediato = false,
  textoOcupado = TEXTO_OCUPADO,
  alExito,
  alError,
  className = 'btn',
  disabled = false,
  ...rest
}) {
  const propio = useAccion()
  const ctl = control ?? propio
  const ocupado = ctl.ocupado
  const visible = ctl.visible
  const hecho = ctl.exito
  const activo = visible || hecho

  function manejarClic(evento) {
    if (!onClick) return
    evento.preventDefault()
    ctl.ejecutar(() => onClick(evento), {
      accion,
      exito: mensajeExito,
      sinExito,
      inmediato,
      alExito,
      alError,
    })
  }

  return (
    <button
      {...rest}
      type={type}
      className={`${className} btn-accion`}
      disabled={disabled || ocupado}
      aria-busy={ocupado}
      onClick={onClick ? manejarClic : undefined}
    >
      <span className="btn-accion__contenido">
        <span className="btn-accion__base" style={{ visibility: activo ? 'hidden' : 'visible' }}>
          {children}
        </span>
        {activo ? (
          <span className="btn-accion__estado">
            {visible ? <span className="btn-accion__spinner" aria-hidden="true" /> : null}
            {visible ? textoOcupado : TEXTO_EXITO_BOTON}
          </span>
        ) : null}
      </span>
    </button>
  )
}
