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
import { getMiMembresia, getParametros, listarPerfilesCobro } from '../firebase/db'
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
  // Parámetros y perfiles de cobro: alimentan el formulario de reserva.
  const [parametros, setParametros] = useState(null)
  const [perfilesCobro, setPerfilesCobro] = useState(null)

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

  /*
   * Configuración de cobros: se lee UNA vez cuando se confirma el acceso de
   * admin. Ambas lecturas son tolerantes a fallos: si fallan, el formulario
   * simplemente no ofrece precio (sigue funcionando con los defaults).
   */
  useEffect(() => {
    if (!habilitado) return undefined
    let activo = true
    Promise.all([getParametros(db, academia), listarPerfilesCobro(db, academia)])
      .then(([params, perfiles]) => {
        if (!activo) return
        setParametros(params)
        setPerfilesCobro(perfiles)
      })
      .catch(() => {
        if (!activo) return
        setParametros(null)
        setPerfilesCobro([])
      })
    return () => {
      activo = false
    }
  }, [academia, habilitado])

  const { sedes, sedeId, setSedeId, fecha, setFecha, clases, cargando, error, recargar } =
    useAgenda(academia, habilitado)

  const [mes, setMes] = useState(hoy)
  const [canchaId, setCanchaId] = useState(null)
  const [claseSelId, setClaseSelId] = useState(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [claseEdit, setClaseEdit] = useState(null)
  // Hueco (cancha + hora) del clic en una hora libre: prellena la reserva nueva.
  const [hueco, setHueco] = useState(null)

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
    setHueco(null)
  }

  function irA(delta) {
    const destino = sumarDias(fecha, delta)
    setFecha(destino)
    setMes(destino)
    setClaseSelId(null)
    setMostrarForm(false)
    setHueco(null)
  }

  function irHoy() {
    setFecha(hoy)
    setMes(hoy)
    setClaseSelId(null)
    setMostrarForm(false)
    setHueco(null)
  }

  function elegirFecha(iso) {
    setFecha(iso)
    setMes(iso)
    setClaseSelId(null)
    setMostrarForm(false)
    setHueco(null)
  }

  function abrirFormulario() {
    if (!esAdmin) return
    setClaseSelId(null)
    setClaseEdit(null)
    setHueco(null)
    setMostrarForm(true)
  }

  /*
   * Clic en una hora libre de la grilla: MISMO formulario de reserva nueva, con
   * la cancha y la hora del hueco ya puestas y el día que se está viendo. El
   * formulario decide si el hueco sigue siendo reservable; acá solo se abre.
   */
  function abrirHueco(nuevoHueco) {
    if (!esAdmin) return
    setClaseSelId(null)
    setClaseEdit(null)
    setHueco(nuevoHueco)
    setMostrarForm(true)
  }

  function abrirReprogramar(clase) {
    if (!esAdmin) return
    setClaseSelId(null)
    setClaseEdit(clase)
    setHueco(null)
    setMostrarForm(true)
  }

  function cerrarFormulario() {
    setMostrarForm(false)
    setClaseEdit(null)
    setHueco(null)
  }

  /*
   * Tras guardar una reserva (o una reprogramación) solo se cierra el formulario
   * y se recargan los datos: la clase aparece en la grilla. NO se abre la hoja de
   * detalle: la asistencia se registra más tarde, no al reservar. `onCreated`
   * sigue recibiendo el id de la clase, pero acá ya no se usa para seleccionar.
   */
  function alCrear() {
    setMostrarForm(false)
    setClaseEdit(null)
    setHueco(null)
    setClaseSelId(null)
    recargar()
  }

  function cambiarMes(delta) {
    const d = aFecha(mes)
    d.setMonth(d.getMonth() + delta)
    setMes(aISO(d))
  }

  /*
   * Un formulario por contexto: la reprogramación va por clase, el clic en un
   * hueco por cancha+hora, y la reserva nueva "pelada" por defecto. Cambiar de
   * contexto remonta el formulario, así el prellenado y la foto inicial de
   * "sin cambios" se recalculan desde cero.
   */
  const claveForm =
    claseEdit?.id ?? (hueco ? `hueco-${hueco.canchaId}-${hueco.horaInicio}` : 'nueva')

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
          onSelectHueco={abrirHueco}
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
            parametros={parametros}
            onClose={cerrarDetalle}
            onChanged={recargar}
            onReprogramar={abrirReprogramar}
          />
        ) : null}
        {mostrarForm && esAdmin ? (
          <NuevaReserva
            key={claveForm}
            tenantId={academia}
            sede={sede}
            canchas={canchas}
            fecha={fecha}
            clases={clases}
            clase={claseEdit}
            hueco={hueco}
            parametros={parametros}
            perfiles={perfilesCobro}
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
          rol={rol}
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

          <TimeGrid
            sede={sede}
            canchas={canchas}
            clases={clases}
            fecha={fecha}
            escala={1}
            onSelect={seleccionarClase}
            onSelectHueco={abrirHueco}
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
              parametros={parametros}
              onClose={cerrarDetalle}
              onChanged={recargar}
              onReprogramar={abrirReprogramar}
            />
          ) : null}

          {mostrarForm && esAdmin ? (
            <NuevaReserva
              key={claveForm}
              tenantId={academia}
              sede={sede}
              canchas={canchas}
              fecha={fecha}
              clases={clases}
              clase={claseEdit}
              hueco={hueco}
              parametros={parametros}
              perfiles={perfilesCobro}
              onClose={cerrarFormulario}
              onCreated={alCrear}
            />
          ) : null}
        </main>
      </div>
    </div>
  )
}
