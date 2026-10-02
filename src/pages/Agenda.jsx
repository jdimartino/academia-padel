import { useMemo, useState } from 'react'
import AgendaMobile from '../components/AgendaMobile'
import Background from '../components/Background'
import DetailSheet from '../components/DetailSheet'
import Sidebar from '../components/Sidebar'
import TimeGrid from '../components/TimeGrid'
import { ChevronLeft, ChevronRight } from '../components/Icons'
import useMediaQuery from '../hooks/useMediaQuery'
import { aFecha, aISO, formatearFechaLarga, hoyISO, sumarDias } from '../lib/fechas'
import { SEDES_MUESTRA, clasesDeMuestra } from './agendaSample'

export default function Agenda() {
  const esDesktop = useMediaQuery('(min-width: 1024px)')
  const hoy = hoyISO()

  const [fecha, setFecha] = useState(hoy)
  const [mes, setMes] = useState(hoy)
  const [sedeId, setSedeId] = useState(SEDES_MUESTRA[0].id)
  const [canchaId, setCanchaId] = useState(SEDES_MUESTRA[0].canchas[0].id)
  const [claseSel, setClaseSel] = useState(null)

  const sede = SEDES_MUESTRA.find((s) => s.id === sedeId) ?? SEDES_MUESTRA[0]
  const clases = useMemo(() => clasesDeMuestra(sede, fecha), [sede, fecha])
  const canchaSel = sede.canchas.find((c) => c.id === canchaId) ?? sede.canchas[0]

  function elegirSede(id) {
    const nueva = SEDES_MUESTRA.find((s) => s.id === id)
    setSedeId(id)
    setCanchaId(nueva.canchas[0].id)
    setClaseSel(null)
  }

  function irA(delta) {
    const destino = sumarDias(fecha, delta)
    setFecha(destino)
    setMes(destino)
  }

  function irHoy() {
    setFecha(hoy)
    setMes(hoy)
  }

  function elegirFecha(iso) {
    setFecha(iso)
    setMes(iso)
  }

  function cambiarMes(delta) {
    const d = aFecha(mes)
    d.setMonth(d.getMonth() + delta)
    setMes(aISO(d))
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

  const cerrar = () => setClaseSel(null)

  if (!esDesktop) {
    return (
      <div className="app app--mobile">
        <Background />
        <AgendaMobile
          sedes={SEDES_MUESTRA}
          sede={sede}
          onSede={elegirSede}
          fecha={fecha}
          hoy={hoy}
          onSeleccionarFecha={elegirFecha}
          canchas={sede.canchas}
          canchaId={canchaId}
          onCancha={setCanchaId}
          clases={clases}
          totalClases={clases.filter((c) => c.canchaId === canchaSel.id).length}
          onSelectClase={setClaseSel}
        />
        {claseSel ? (
          <DetailSheet
            clase={claseSel}
            canchas={sede.canchas}
            sedeNombre={sede.nombre}
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
          sedes={SEDES_MUESTRA}
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
              <p className="eyebrow">Agenda · {sede.nombre}</p>
              <h1 className="main__fecha">{formatearFechaLarga(fecha)}</h1>
              <p className="main__resumen">
                {sede.nombre} · {sede.canchas.length} canchas · {clases.length} clases
              </p>
            </div>
            {navDias}
          </header>

          <TimeGrid canchas={sede.canchas} clases={clases} escala={1} onSelect={setClaseSel} />

          {claseSel ? (
            <DetailSheet
              clase={claseSel}
              canchas={sede.canchas}
              sedeNombre={sede.nombre}
              onClose={cerrar}
            />
          ) : null}
        </main>
      </div>
    </div>
  )
}
