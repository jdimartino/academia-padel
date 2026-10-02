import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import AgendaMobile from '../components/AgendaMobile'
import Background from '../components/Background'
import DetailSheet from '../components/DetailSheet'
import EstadoMensaje from '../components/EstadoMensaje'
import Sidebar from '../components/Sidebar'
import TimeGrid from '../components/TimeGrid'
import { ChevronLeft, ChevronRight } from '../components/Icons'
import useAgenda from '../hooks/useAgenda'
import useMediaQuery from '../hooks/useMediaQuery'
import { aFecha, aISO, formatearFechaLarga, hoyISO, sumarDias } from '../lib/fechas'

function Aviso({ children }) {
  return (
    <p className="aviso glass" role="status" aria-live="polite">
      {children}
    </p>
  )
}

export default function Agenda() {
  const { academia } = useParams()
  const esDesktop = useMediaQuery('(min-width: 1024px)')
  const hoy = hoyISO()

  const { sedes, sedeId, setSedeId, fecha, setFecha, clases, cargando, error } = useAgenda(academia)

  const [mes, setMes] = useState(hoy)
  const [canchaId, setCanchaId] = useState(null)
  const [claseSel, setClaseSel] = useState(null)

  const sede = useMemo(
    () => sedes?.find((s) => s.id === sedeId) ?? sedes?.[0] ?? null,
    [sedes, sedeId],
  )
  const canchas = sede?.canchas ?? []
  const canchaSel = canchas.find((c) => c.id === canchaId) ?? canchas[0] ?? null

  function elegirSede(id) {
    setSedeId(id)
    const nueva = sedes?.find((s) => s.id === id)
    setCanchaId(nueva?.canchas?.[0]?.id ?? null)
    setClaseSel(null)
  }

  function irA(delta) {
    const destino = sumarDias(fecha, delta)
    setFecha(destino)
    setMes(destino)
    setClaseSel(null)
  }

  function irHoy() {
    setFecha(hoy)
    setMes(hoy)
    setClaseSel(null)
  }

  function elegirFecha(iso) {
    setFecha(iso)
    setMes(iso)
    setClaseSel(null)
  }

  function cambiarMes(delta) {
    const d = aFecha(mes)
    d.setMonth(d.getMonth() + delta)
    setMes(aISO(d))
  }

  if (!sedes) {
    if (error) return <EstadoMensaje titulo="No se pudo cargar la agenda" detalle={error} />
    return <EstadoMensaje titulo="Cargando agenda…" />
  }

  if (sedes.length === 0) {
    return <EstadoMensaje titulo="Esta academia todavía no tiene sedes." />
  }

  const navDias = (
    <div className="nav-dias">
      <button type="button" className="icon-btn" aria-label="Día anterior" onClick={() => irA(-1)}>
        <ChevronLeft />
      </button>
      <button type="button" className="pill" onClick={irHoy}>
        Hoy
      </button>
      <button type="button" className="icon-btn" aria-label="Día siguiente" onClick={() => irA(1)}>
        <ChevronRight />
      </button>
    </div>
  )

  const aviso = error
    ? `No se pudieron cargar las clases: ${error}`
    : cargando
      ? 'Cargando clases…'
      : clases.length === 0
        ? 'Sin clases para este día.'
        : null
  const cerrar = () => setClaseSel(null)

  if (!esDesktop) {
    return (
      <div className="app app--mobile">
        <Background />
        {aviso ? <Aviso>{aviso}</Aviso> : null}
        <AgendaMobile
          sedes={sedes}
          sede={sede}
          onSede={elegirSede}
          fecha={fecha}
          hoy={hoy}
          onSeleccionarFecha={elegirFecha}
          canchas={canchas}
          canchaId={canchaSel?.id ?? null}
          onCancha={setCanchaId}
          clases={clases}
          totalClases={clases.filter((c) => c.canchaId === canchaSel?.id).length}
          onSelectClase={setClaseSel}
        />
        {claseSel ? (
          <DetailSheet
            clase={claseSel}
            canchas={canchas}
            sedeNombre={sede?.nombre}
            onClose={cerrar}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="app">
      <Background />
      <div className="shell">
        <Sidebar
          sedes={sedes}
          sedeId={sedeId}
          onSede={elegirSede}
          mes={mes}
          fecha={fecha}
          hoy={hoy}
          onSeleccionarFecha={elegirFecha}
          onCambiarMes={cambiarMes}
        />

        <main className="main">
          <header className="main__header">
            <div>
              <p className="eyebrow">Agenda · {sede?.nombre}</p>
              <h1 className="main__fecha">{formatearFechaLarga(fecha)}</h1>
              <p className="main__resumen">
                {sede?.nombre} · {canchas.length} canchas · {clases.length} clases
              </p>
            </div>
            {navDias}
          </header>

          {aviso ? <Aviso>{aviso}</Aviso> : null}

          <TimeGrid canchas={canchas} clases={clases} escala={1} onSelect={setClaseSel} />

          {claseSel ? (
            <DetailSheet
              clase={claseSel}
              canchas={canchas}
              sedeNombre={sede?.nombre}
              onClose={cerrar}
            />
          ) : null}
        </main>
      </div>
    </div>
  )
}
