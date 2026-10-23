/*
 * Toasts globales (éxito y error): abajo de la pantalla —a la derecha en
 * desktop, a todo el ancho con márgenes en mobile— respetando el safe-area.
 * No roban el foco, se cierran al tocarlos y se van solos (ver DURACION_TOAST).
 * El contenedor es la región viva: existe siempre, aunque esté vacío, para que
 * el lector de pantalla anuncie el primer aviso. Los errores son siempre
 * visibles; los éxitos solo para acciones importantes o de dinero.
 */
export default function ToastsExito({ toasts, onCerrar }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast glass-strong${toast.tipo === 'error' ? ' toast--error' : ''}`}
          onClick={() => onCerrar(toast.id)}
        >
          {toast.mensaje}
        </div>
      ))}
    </div>
  )
}
