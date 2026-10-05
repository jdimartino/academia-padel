import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import AgendaMobile from '../components/AgendaMobile'
import Background from '../components/Background'
import DetailSheet from '../components/DetailSheet'
import EstadoMensaje from '../components/EstadoMensaje'
import NuevaReserva from '../components/NuevaReserva'
import Sidebar from '../components/Sidebar'
import TimeGrid from '../components/TimeGrid'
import { ChevronLeft, ChevronRight } from '../components/Icons'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { getMiMembresia } from '../firebase/db'
import useAgenda from '../hooks/useAgenda'
import useMediaQuery from '../hooks/useMediaQuery'
import { contarSinCerrar } from '../lib/agenda'
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
  const { user } = useAuth()
  const esDesktop = useMediaQuery('(min-width: 1024px)')
  const hoy = hoyISO()

  const [rol, setRol] = useState(null)
  const [membresiaLista, setMembresiaLista] = useState(false)

  /*
   * Única lectura de un no-admin: su propia membresía. Hasta que no se confirme
   * que es administrador, la agenda no dispara ninguna otra lectura.
   */
  useEffect(() => {
    let activo = true
    getMiMembresia(db, academia, user.uid)
      .then((membresia) => {
        if (!activo) return
        setRol(membresia?.rol ?? null)
        setMembresiaLista(true)
      })
      .catch(() => {
        if (!activo) return
        setRol(null)
        setMembresiaLista(true)
      })
    return () => {
      activo = false
    }
  }, [academia, user.uid])

  const esAdmin = rol === 'administrador'
  const habilitado = membresiaLista && esAdmin

  const { sedes, sedeId, setSedeId, fecha, setFecha, clases, cargando, error, recargar } =
    useAgenda(academia, habilitado)

  const [mes, setMes] = useState(hoy)
  const [canchaId, setCanchaId] = useState(null)
  const [claseSelId, setClaseSelId] = useState(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [claseEdit, setClaseEdit] = useState(null)

  /*
   * El detalle se DERIVA de la lectura del día (igual que hace useAgenda con
   * `cargando`), no se guarda una copia del objeto. Así, tras cualquier
   * refresh —crear, reprogramar, cancelar, asistencia— la hoja abierta refleja
   * el estado nuevo sin cerrarse, y una clase recién reservada se abre sola
   * en cuanto la lectura del día la trae.
   */
  const claseSel = useMemo(
    () => (claseSelId ? (clases.find((c) => c.id === claseSelId) ?? null) : null),
    [clases, claseSelId],
  )

  // Clases "reservada" cuyo fin ya pasó en hora local y siguen sin cerrar.
  const sinCerrar = useMemo(() => contarSinCerrar(clases), [clases])
  const seleccionarClase = useCallback((c) => setClaseSelId(c.id), [])
  const cerrarDetalle = useCallback(() => setClaseSelId(null), [])

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
    setClaseSelId(null)
    setMostrarForm(false)
  }

  function irA(delta) {
    const destino = sumarDias(fecha, delta)
    setFecha(destino)
    setMes(destino)
    setClaseSelId(null)
    setMostrarForm(false)
  }

  function irHoy() {
    setFecha(hoy)
    setMes(hoy)
    setClaseSelId(null)
    setMostrarForm(false)
  }

  function elegirFecha(iso) {
    setFecha(iso)
    setMes(iso)
    setClaseSelId(null)
    setMostrarForm(false)
  }

  function abrirFormulario() {
    if (!esAdmin) return
    setClaseSelId(null)
    setClaseEdit(null)
    setMostrarForm(true)
  }

  function abrirReprogramar(clase) {
    if (!esAdmin) return
    setClaseSelId(null)
    setClaseEdit(clase)
    setMostrarForm(true)
  }

  function cerrarFormulario() {
    setMostrarForm(false)
    setClaseEdit(null)
  }

  function alCrear(claseId) {
    setMostrarForm(false)
    setClaseEdit(null)
    // La hoja de detalle se abre sola sobre la clase recién reservada.
    if (claseId) setClaseSelId(claseId)
    recargar()
  }

  function cambiarMes(delta) {
    const d = aFecha(mes)
    d.setMonth(d.getMonth() + delta)
    setMes(aISO(d))
  }

  if (!membresiaLista) {
    return <EstadoMensaje titulo="Cargando…" />
  }

  // Profesor, alumno y representante son fichas, no usuarios: no tienen acceso.
  if (!esAdmin) {
    return <EstadoMensaje titulo="Esta cuenta no tiene acceso a esta academia" />
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
          sinCerrar={sinCerrar}
          onSelectClase={seleccionarClase}
          puedeReservar={esAdmin}
          onNuevaReserva={abrirFormulario}
        />
        {claseSel ? (
          <DetailSheet
            key={claseSel.id}
            clase={claseSel}
            canchas={canchas}
            clases={clases}
            sedeNombre={sede?.nombre}
            tenantId={academia}
            rol={rol}
            onClose={cerrarDetalle}
            onChanged={recargar}
            onReprogramar={abrirReprogramar}
          />
        ) : null}
        {mostrarForm && esAdmin ? (
          <NuevaReserva
            key={claseEdit?.id ?? "nueva"}
            tenantId={academia}
            sede={sede}
            canchas={canchas}
            fecha={fecha}
            clases={clases}
            clase={claseEdit}
            onClose={cerrarFormulario}
            onCreated={alCrear}
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
          puedeReservar={esAdmin}
          onNuevaReserva={abrirFormulario}
        />

        <main className="main">
          <header className="main__header">
            <div>
              <p className="eyebrow">Agenda · {sede?.nombre}</p>
              <h1 className="main__fecha">{formatearFechaLarga(fecha)}</h1>
              <p className="main__resumen">
                {sede?.nombre} · {canchas.length} canchas · {clases.length} clases
                {sinCerrar ? ` · ${sinCerrar} sin cerrar` : ''}
              </p>
            </div>
            {navDias}
          </header>

          {aviso ? <Aviso>{aviso}</Aviso> : null}

          <TimeGrid canchas={canchas} clases={clases} escala={1} onSelect={seleccionarClase} />

          {claseSel ? (
            <DetailSheet
              key={claseSel.id}
              clase={claseSel}
              canchas={canchas}
              clases={clases}
              sedeNombre={sede?.nombre}
              tenantId={academia}
              rol={rol}
              onClose={cerrarDetalle}
              onChanged={recargar}
              onReprogramar={abrirReprogramar}
            />
          ) : null}

          {mostrarForm && esAdmin ? (
            <NuevaReserva
              key={claseEdit?.id ?? "nueva"}
              tenantId={academia}
              sede={sede}
              canchas={canchas}
              fecha={fecha}
              clases={clases}
              clase={claseEdit}
              onClose={cerrarFormulario}
              onCreated={alCrear}
            />
          ) : null}
        </main>
      </div>
    </div>
  )
}
