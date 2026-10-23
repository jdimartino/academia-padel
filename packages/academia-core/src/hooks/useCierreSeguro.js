import { useCallback, useEffect } from 'react'
import { useAvisos } from '../context/AvisosContext'

/*
 * Cierre seguro de un sheet/panel con formulario:
 * - sin cambios → cierra, igual que el botón Cancelar;
 * - con cambios → NO cierra: abre el diálogo "¿Salir sin guardar?" (Seguir
 *   editando enfocado; Salir sin guardar cierra el sheet);
 * - si hay un diálogo abierto, el Escape lo consume el diálogo y acá no se
 *   hace nada (el formulario de abajo queda intacto con sus datos).
 *
 * `interceptar` es opcional: si devuelve true, ese Escape ya fue atendido por
 * el propio componente (p. ej. cerrar una confirmación en línea).
 *
 * Devuelve `intentarCerrar` para poder usarlo también desde el fondo del sheet.
 */
export default function useCierreSeguro({ sucio = false, onCerrar, interceptar = null }) {
  const { confirmar, hayDialogo } = useAvisos()

  const intentarCerrar = useCallback(async () => {
    if (interceptar?.()) return
    if (!sucio) {
      onCerrar?.()
      return
    }
    const salir = await confirmar({
      titulo: '¿Salir sin guardar?',
      mensaje: 'Tienes cambios sin guardar.',
      textoCancelar: 'Seguir editando',
      textoConfirmar: 'Salir sin guardar',
    })
    if (salir) onCerrar?.()
  }, [confirmar, interceptar, onCerrar, sucio])

  useEffect(() => {
    function alTeclear(event) {
      if (event.key !== 'Escape') return
      // Con un diálogo abierto, Escape cierra SOLO el diálogo.
      if (hayDialogo) return
      event.preventDefault()
      intentarCerrar()
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [hayDialogo, intentarCerrar])

  return intentarCerrar
}
