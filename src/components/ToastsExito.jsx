/*
 * Toasts de éxito: arriba de la pantalla, centrados en desktop y a todo el
 * ancho con márgenes en mobile, respetando el safe-area del notch. No roban el
 * foco, se cierran al tocarlos y se van solos (ver DURACION_TOAST).
 * El contenedor es la región viva: existe siempre, aunque esté vacío, para que
 * el lector de pantalla anuncie el primer aviso.
 */
export default function ToastsExito({ toasts, onCerrar }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast glass-strong"
          onClick={() => onCerrar(toast.id)}
        >
          {toast.mensaje}
        </div>
      ))}
    </div>
  )
}
