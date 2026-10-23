import Background from './Background'

export default function EstadoMensaje({ titulo, detalle }) {
  return (
    <div className="app">
      <Background />
      <div className="estado-wrap">
        <div className="estado glass" role="status" aria-live="polite">
          <p className="estado__titulo">{titulo}</p>
          {detalle ? <p className="estado__detalle">{detalle}</p> : null}
        </div>
      </div>
    </div>
  )
}
