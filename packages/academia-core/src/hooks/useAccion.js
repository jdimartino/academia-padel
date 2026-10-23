import { useCallback, useEffect, useRef, useState } from 'react'
import { useAvisos } from '../context/AvisosContext'
import { esErrorDeNegocio } from '../lib/avisos'
import {
  DURACION_EXITO_MS,
  MIN_VISIBLE_OCUPADO_MS,
  OCUPADO_INICIAL,
  RETRASO_OCUPADO_MS,
  esperaParaReiniciar,
  iniciarOcupado,
  mostrarOcupado,
  terminarOcupado,
} from '../lib/accion'

/*
 * useAccion: envuelve una operación asíncrona y expone su feedback de forma
 * no intrusiva (Parte 1).
 *
 * - El botón que lo usa queda deshabilitado DESDE EL CLIC.
 * - El spinner aparece recién si la acción tarda más de RETRASO_OCUPADO_MS y,
 *   una vez visible, permanece al menos MIN_VISIBLE_OCUPADO_MS.
 * - Al terminar bien, si se pasó `exito` se muestra un toast; si no, el botón
 *   muestra "Guardado ✓" durante DURACION_EXITO_MS.
 * - Si falla, se re-habilita y se avisa: error de negocio por toast, técnico
 *   por el diálogo con referencia copiable.
 *
 * La cuenta atrás vive en src/lib/accion.js (pura y probada). Acá solo hay
 * temporizadores y estado de React.
 */
export default function useAccion() {
  const { avisarError, mostrarErrorTecnico, mostrarExito } = useAvisos()
  const [estado, setEstado] = useState(OCUPADO_INICIAL)
  const [exito, setExito] = useState(false)
  const estadoRef = useRef(estado)
  const retrasoRef = useRef(null)
  const reinicioRef = useRef(null)
  const exitoRef = useRef(null)

  const aplicar = useCallback((siguiente) => {
    estadoRef.current = siguiente
    setEstado(siguiente)
  }, [])

  const limpiar = useCallback(() => {
    clearTimeout(retrasoRef.current)
    clearTimeout(reinicioRef.current)
    clearTimeout(exitoRef.current)
  }, [])

  useEffect(() => limpiar, [limpiar])

  /**
   * Ejecuta `fn` con feedback. Opciones:
   * - `accion`: clave kebab para la referencia del error técnico.
   * - `exito`: mensaje del toast de éxito (acciones importantes/de dinero).
   * - `inmediato`: true para acciones largas conocidas (PDF, BCV, reportes):
   *   muestra el spinner sin esperar el retraso.
   * - `retraso` / `minimo`: overrides de tiempos (por defecto los del módulo).
   * - `alExito`: callback con el resultado, tras el éxito.
   * - `alError`: callback con el error, en lugar del manejo estándar.
   */
  const ejecutar = useCallback(
    async (fn, opciones = {}) => {
      const {
        accion = 'accion',
        exito: mensajeExito = null,
        sinExito = false,
        inmediato = false,
        retraso = RETRASO_OCUPADO_MS,
        minimo = MIN_VISIBLE_OCUPADO_MS,
        alExito,
        alError,
      } = opciones

      limpiar()
      setExito(false)
      aplicar(iniciarOcupado(Date.now()))

      // El temporizador del retraso: 0 para acciones inmediatas.
      retrasoRef.current = setTimeout(
        () => aplicar(mostrarOcupado(estadoRef.current, Date.now())),
        inmediato ? 0 : retraso,
      )

      const cerrar = (conExito) => {
        clearTimeout(retrasoRef.current)
        const terminado = terminarOcupado(estadoRef.current)
        estadoRef.current = terminado
        const aplicarFin = () => {
          limpiar()
          aplicar(OCUPADO_INICIAL)
          if (conExito && !sinExito) {
            if (mensajeExito) {
              mostrarExito(mensajeExito)
            } else {
              setExito(true)
              exitoRef.current = setTimeout(() => setExito(false), DURACION_EXITO_MS)
            }
          }
        }
        const espera = esperaParaReiniciar(terminado, Date.now(), minimo)
        if (espera <= 0) aplicarFin()
        else reinicioRef.current = setTimeout(aplicarFin, espera)
      }

      try {
        const resultado = await fn()
        cerrar(true)
        alExito?.(resultado)
        return resultado
      } catch (err) {
        cerrar(false)
        if (alError) {
          alError(err)
        } else if (esErrorDeNegocio(err)) {
          avisarError(err.message)
        } else {
          mostrarErrorTecnico(accion, err)
        }
        return undefined
      }
    },
    [aplicar, avisarError, limpiar, mostrarErrorTecnico, mostrarExito],
  )

  return {
    ejecutar,
    ocupado: estado.activo || estado.visible,
    visible: estado.visible,
    exito,
  }
}
