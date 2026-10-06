import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import DialogoAviso from '../components/DialogoAviso'
import ToastsExito from '../components/ToastsExito'
import {
  AVISOS_INICIAL,
  avisoDeError,
  cerrarError,
  cerrarToast,
  cerrarVencidos,
  dialogoActual,
  hayDialogo as hayDialogoEnEstado,
  mostrarConfirmacion,
  mostrarError as encolarError,
  mostrarExito as encolarExito,
} from '../lib/avisos'

const AvisosContext = createContext(null)

/*
 * Provider ÚNICO de feedback al usuario (se monta una sola vez, en App):
 * - mostrarError(mensaje): diálogo con un mensaje ya listo para el usuario.
 * - mostrarErrorTecnico(accion, error): decide solo. Si el error es de negocio
 *   (clases de db.js) muestra su mensaje tal cual; si es técnico (FirebaseError,
 *   TypeError, red, desconocido) muestra el mensaje genérico + referencia
 *   copiable, y deja el error original y la referencia en console.error.
 * - mostrarExito(mensaje): toast de éxito.
 * - confirmar(opciones): diálogo de confirmación; resuelve true/false.
 *
 * Los diálogos son una cola: se muestra uno por vez y no se duplican. Los
 * toasts se van solos a los DURACION_TOAST ms.
 */
export function AvisosProvider({ children }) {
  const [estado, setEstado] = useState(AVISOS_INICIAL)
  // Resolver del diálogo de confirmación que está esperando respuesta.
  const pendienteRef = useRef(null)

  const mostrarError = useCallback((mensaje) => {
    setEstado((prev) => encolarError(prev, { mensaje }))
  }, [])

  const mostrarErrorTecnico = useCallback((accion, error) => {
    const aviso = avisoDeError(accion, error)
    // El error completo y la referencia quedan en consola, no en pantalla.
    if (aviso.tecnico) console.error(aviso.referencia, error)
    else console.error(`[${accion}]`, error)
    setEstado((prev) => encolarError(prev, aviso))
  }, [])

  const mostrarExito = useCallback((mensaje) => {
    setEstado((prev) => encolarExito(prev, mensaje))
  }, [])

  const confirmar = useCallback((opciones) => {
    // Un solo diálogo de confirmación a la vez: si ya hay uno esperando, se
    // devuelve su misma promesa (nunca queda una promesa sin resolver).
    if (pendienteRef.current) return pendienteRef.current.promesa
    const promesa = new Promise((resolve) => {
      pendienteRef.current = { resolve }
      setEstado((prev) => mostrarConfirmacion(prev, opciones))
    })
    return promesa
  }, [])

  const cerrarDialogo = useCallback(
    (confirmado) => {
      const actual = dialogoActual(estado)
      if (actual?.tipo === 'confirm') {
        const pendiente = pendienteRef.current
        pendienteRef.current = null
        if (pendiente) pendiente.resolve(confirmado)
      }
      setEstado((prev) => cerrarError(prev))
    },
    [estado],
  )

  const cerrarDialogoAbajo = useCallback(() => cerrarDialogo(false), [cerrarDialogo])
  const confirmarDialogo = useCallback(() => cerrarDialogo(true), [cerrarDialogo])

  const cerrarToastPorId = useCallback((id) => {
    setEstado((prev) => cerrarToast(prev, id))
  }, [])

  // Auto-cierre: un temporizador por tanda, apuntado al toast que vence antes.
  useEffect(() => {
    if (!estado.toasts.length) return undefined
    const falta = Math.min(
      ...estado.toasts.map((toast) => toast.creadoEn + toast.duracion - Date.now()),
    )
    const timer = setTimeout(() => setEstado((prev) => cerrarVencidos(prev)), Math.max(0, falta))
    return () => clearTimeout(timer)
  }, [estado.toasts])

  const dialogo = dialogoActual(estado)

  const valor = useMemo(
    () => ({
      mostrarError,
      mostrarErrorTecnico,
      mostrarExito,
      confirmar,
      hayDialogo: hayDialogoEnEstado(estado),
    }),
    [confirmar, estado, mostrarError, mostrarErrorTecnico, mostrarExito],
  )

  return (
    <AvisosContext.Provider value={valor}>
      {children}
      <ToastsExito toasts={estado.toasts} onCerrar={cerrarToastPorId} />
      {dialogo ? (
        <DialogoAviso
          key={dialogo.clave}
          dialogo={dialogo}
          onCerrar={cerrarDialogoAbajo}
          onConfirmar={confirmarDialogo}
        />
      ) : null}
    </AvisosContext.Provider>
  )
}

export function useAvisos() {
  const context = useContext(AvisosContext)
  if (!context) {
    throw new Error('useAvisos debe usarse dentro de <AvisosProvider>')
  }
  return context
}

export default AvisosContext
