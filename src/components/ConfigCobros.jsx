import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAvisos } from '../context/AvisosContext'
import { db } from '../firebase/config'
import {
  actualizarPerfilCobro,
  cambiarActivaPerfilCobro,
  crearPerfilCobro,
  getParametros,
  listarPerfilesCobro,
  setParametros,
} from '../firebase/db'
import {
  AUSENCIA_HORAS_MAX,
  LIMITE_NOMBRE_PERFIL,
  MODOS_COBRO,
  PERFILES_COBRO_DEFAULT,
  PORCENTAJE_MAX,
  VENCIMIENTO_DIAS_MAX,
  ALERTA_DIAS_MAX,
} from '../lib/cobros'
import { MINUTOS_BLOQUE } from '../lib/agenda'
import { formatearUSD, parsearUSD } from '../lib/dinero'
import { esErrorDeNegocio, hayCambios } from '../lib/avisos'
import MenuAcciones from './MenuAcciones'
import { PlusIcon } from './Icons'

const MENSAJE_TECNICO_INLINE = 'No se pudo guardar. Inténtalo de nuevo.'

const MODOS_LABEL = { total: 'Total', por_persona: 'Por persona' }

const PAGO_MODOS = [
  { valor: 'por_hora', label: 'Por hora' },
  { valor: 'por_clase', label: 'Por clase' },
]

const ALERTA_REFERENCIAS = [
  { valor: 'clase', label: 'De la clase' },
  { valor: 'vencimiento', label: 'Del vencimiento' },
]

/* Reglas del cierre de una clase (Phase 4). */
const REPARTOS_AUSENCIA = [
  { valor: 'absorbe_academia', label: 'La absorbe la academia' },
  { valor: 'reparte_entre_presentes', label: 'Repartirla entre los presentes' },
]

const PAGOS_SIN_AVISO = [
  { valor: 'completo', label: 'Completo' },
  { valor: 'proporcional_cobrado', label: 'Proporcional a lo cobrado' },
  { valor: 'nada', label: 'No pagar' },
]

/* Qué hace una falta sin aviso cuando el alumno tiene crédito (Phase 5). */
const FALTAS_CREDITO = [
  { valor: 'descuenta_proporcional', label: 'Descontar el % de falta' },
  { valor: 'descuenta_completo', label: 'Descontar la clase completa' },
  { valor: 'cobra_aparte', label: 'Cobrar aparte (cargo normal)' },
]

/* Duraciones ofrecidas: múltiplos de MINUTOS_BLOQUE de 60 a 240 (1 a 4 horas). */
const DURACIONES_OPCIONES = Array.from({ length: 4 }, (_, i) => (i + 2) * MINUTOS_BLOQUE)

/** "2 personas" | "Cualquiera" para el hint de un perfil. */
function resumenPersonas(personas) {
  if (personas == null) return 'Cualquiera'
  return personas === 1 ? '1 persona' : `${personas} personas`
}

/**
 * Pantalla de Cobros de la academia (Fase 3): perfiles de cobro, tarifas por
 * sede y parámetros. Los perfiles y los parámetros se guardan por acción
 * (los perfiles con su menú, los parámetros con la barra de cambios). No se
 * generan cargos ni pagos: acá solo se CONFIGURA y se sugieren precios.
 */
export default function ConfigCobros({ tenantId, onSucio }) {
  const { user } = useAuth()
  const { mostrarExito, mostrarErrorTecnico } = useAvisos()
  const uid = user?.uid ?? null

  const [perfiles, setPerfiles] = useState(null)
  const [errorPerfiles, setErrorPerfiles] = useState('')
  const [versionPerfiles, setVersionPerfiles] = useState(0)

  const [guardados, setGuardados] = useState(null)
  const [borrador, setBorrador] = useState(null)
  const [montoTexto, setMontoTexto] = useState('')
  const [errorParametros, setErrorParametros] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let activo = true
    listarPerfilesCobro(db, tenantId)
      .then((lista) => {
        if (activo) {
          setPerfiles(lista)
          setErrorPerfiles('')
        }
      })
      .catch((err) => {
        if (!activo) return
        setPerfiles([])
        setErrorPerfiles(err.message)
      })
    return () => {
      activo = false
    }
  }, [tenantId, versionPerfiles])

  useEffect(() => {
    let activo = true
    getParametros(db, tenantId)
      .then((p) => {
        if (!activo) return
        setGuardados(p)
        setBorrador(p)
        setMontoTexto(formatearUSD(p.pagoProfesor.montoCents))
        setErrorParametros('')
      })
      .catch((err) => {
        if (activo) setErrorParametros(err.message)
      })
    return () => {
      activo = false
    }
  }, [tenantId, versionPerfiles])

  const recargarPerfiles = useCallback(() => setVersionPerfiles((v) => v + 1), [])

  const sucio = borrador !== null && guardados !== null && hayCambios(guardados, borrador)

  useEffect(() => {
    onSucio?.(sucio)
  }, [sucio, onSucio])

  const activos = useMemo(
    () => (perfiles ?? []).filter((perfil) => perfil.activo !== false),
    [perfiles],
  )
  const inactivos = useMemo(
    () => (perfiles ?? []).filter((perfil) => perfil.activo === false),
    [perfiles],
  )

  const faltanDefault = useMemo(
    () =>
      PERFILES_COBRO_DEFAULT.filter(
        (perfil) => !(perfiles ?? []).some((existente) => existente.id === perfil.id),
      ),
    [perfiles],
  )

  async function cargarDefaults() {
    setErrorPerfiles('')
    try {
      for (const perfil of faltanDefault) {
        const { id, ...datos } = perfil
        await crearPerfilCobro(db, tenantId, datos, { uid, perfilId: id })
      }
      mostrarExito('Perfiles por defecto cargados')
      recargarPerfiles()
    } catch (err) {
      if (esErrorDeNegocio(err)) setErrorPerfiles(err.message)
      else mostrarErrorTecnico('cargar-perfiles', err)
    }
  }

  function editarParametros(cambios) {
    setErrorParametros('')
    setBorrador((prev) => ({ ...prev, ...cambios }))
  }

  async function guardarParametros() {
    const montoCents = parsearUSD(montoTexto)
    if (montoCents === null) {
      setErrorParametros('El pago del profesor no es un monto válido')
      return
    }
    const payload = { ...borrador, pagoProfesor: { ...borrador.pagoProfesor, montoCents } }
    setGuardando(true)
    setErrorParametros('')
    try {
      const normalizado = await setParametros(db, tenantId, payload, { uid })
      setGuardados(normalizado)
      setBorrador(normalizado)
      setMontoTexto(formatearUSD(normalizado.pagoProfesor.montoCents))
      mostrarExito('Parámetros guardados')
    } catch (err) {
      if (esErrorDeNegocio(err)) setErrorParametros(err.message)
      else {
        setErrorParametros(MENSAJE_TECNICO_INLINE)
        mostrarErrorTecnico('guardar-parametros', err)
      }
    } finally {
      setGuardando(false)
    }
  }

  function descartarParametros() {
    setBorrador(guardados)
    setMontoTexto(formatearUSD(guardados.pagoProfesor.montoCents))
    setErrorParametros('')
  }

  function alternarDuracion(minutos) {
    editarParametros({
      duracionesPermitidas: borrador.duracionesPermitidas.includes(minutos)
        ? borrador.duracionesPermitidas.filter((valor) => valor !== minutos)
        : [...borrador.duracionesPermitidas, minutos].sort((a, b) => a - b),
    })
  }

  if (perfiles === null || borrador === null) {
    return <p className="aviso glass">Cargando cobros…</p>
  }

  const perfilesVisibles = [...activos, ...inactivos]

  return (
    <div className="cobros">
      <section className="detalle glass" aria-label="Perfiles de cobro">
        <div className="lista-sedes__cab">
          <h2 className="lista-sedes__titulo">Perfiles de cobro</h2>
          {faltanDefault.length ? (
            <button type="button" className="btn btn--secondary" onClick={cargarDefaults}>
              Cargar por defecto
            </button>
          ) : null}
        </div>

        {errorPerfiles ? (
          <p className="alert alert--error" role="alert">
            {errorPerfiles}
          </p>
        ) : null}

        {perfilesVisibles.length === 0 ? (
          <p className="aviso">
            Esta academia todavía no tiene perfiles de cobro. Cargá los por defecto o agregá uno.
          </p>
        ) : (
          <ul className="canchas-lista">
            {perfilesVisibles.map((perfil) => (
              <FilaPerfil
                key={perfil.id}
                tenantId={tenantId}
                perfil={perfil}
                uid={uid}
                onChanged={recargarPerfiles}
              />
            ))}
          </ul>
        )}

        <AltaPerfil tenantId={tenantId} uid={uid} onCreated={recargarPerfiles} />
      </section>

      <section className="detalle glass" aria-label="Parámetros de la academia">
        <h2 className="lista-sedes__titulo">Parámetros</h2>
        <p className="general__nota">
          Reglas de negocio de la academia. Los parámetros que todavía no se usan en una fase
          posterior se indican abajo.
        </p>

        <div className="parametros">
          <div className="parametros__bloque">
            <h3 className="parametros__titulo">Ausencias</h3>
            <label className="parametros__campo">
              <span className="form__label">Aviso de ausencia (horas)</span>
              <input
                className="form__input"
                type="number"
                min="0"
                max={AUSENCIA_HORAS_MAX}
                value={borrador.avisoAusenciaHoras}
                onChange={(e) => editarParametros({ avisoAusenciaHoras: Number(e.target.value) })}
              />
            </label>
            <label className="parametros__campo">
              <span className="form__label">Falta sin aviso (% a cobrar)</span>
              <input
                className="form__input"
                type="number"
                min="0"
                max={PORCENTAJE_MAX}
                value={borrador.porcentajeFaltaSinAviso}
                onChange={(e) =>
                  editarParametros({ porcentajeFaltaSinAviso: Number(e.target.value) })
                }
              />
              <span className="parametros__hint">Se aplica en la fase de cobros.</span>
            </label>
          </div>

          <div className="parametros__bloque">
            <h3 className="parametros__titulo">Profesores</h3>
            <label className="parametros__campo">
              <span className="form__label">Pago al profesor</span>
              <select
                className="form__input"
                value={borrador.pagoProfesor.modo}
                onChange={(e) =>
                  editarParametros({
                    pagoProfesor: { ...borrador.pagoProfesor, modo: e.target.value },
                  })
                }
              >
                {PAGO_MODOS.map((opcion) => (
                  <option key={opcion.valor} value={opcion.valor}>
                    {opcion.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="parametros__campo">
              <span className="form__label">Monto por hora / clase (USD)</span>
              <input
                className="form__input"
                type="text"
                inputMode="decimal"
                value={montoTexto}
                onChange={(e) => setMontoTexto(e.target.value)}
              />
              <span className="parametros__hint">Se aplica en la liquidación (fase posterior).</span>
            </label>
          </div>

          <div className="parametros__bloque">
            <h3 className="parametros__titulo">Cierre de clases</h3>
            <label className="parametros__campo">
              <span className="form__label">Si un alumno avisó su ausencia (monto total)</span>
              <select
                className="form__input"
                value={borrador.repartoAusenciaAvisada}
                onChange={(e) => editarParametros({ repartoAusenciaAvisada: e.target.value })}
              >
                {REPARTOS_AUSENCIA.map((opcion) => (
                  <option key={opcion.valor} value={opcion.valor}>
                    {opcion.label}
                  </option>
                ))}
              </select>
              <span className="parametros__hint">Se aplica al cerrar la clase y facturar.</span>
            </label>
            <label className="parametros__campo">
              <span className="form__label">Si nadie asiste y hubo faltas sin aviso</span>
              <select
                className="form__input"
                value={borrador.pagoProfesorSiTodosFaltanSinAviso}
                onChange={(e) =>
                  editarParametros({ pagoProfesorSiTodosFaltanSinAviso: e.target.value })
                }
              >
                {PAGOS_SIN_AVISO.map((opcion) => (
                  <option key={opcion.valor} value={opcion.valor}>
                    {opcion.label}
                  </option>
                ))}
              </select>
              <span className="parametros__hint">Qué se le paga al profesor en ese caso.</span>
            </label>
          </div>

          <div className="parametros__bloque">
            <h3 className="parametros__titulo">Descuentos</h3>
            <label className="parametros__campo">
              <span className="form__label">Hermanos (% de descuento)</span>
              <input
                className="form__input"
                type="number"
                min="0"
                max={PORCENTAJE_MAX}
                value={borrador.descuentoHermanosPct}
                onChange={(e) =>
                  editarParametros({ descuentoHermanosPct: Number(e.target.value) })
                }
              />
              <span className="parametros__hint">Se aplica en la fase de cobros.</span>
            </label>
          </div>

          <div className="parametros__bloque">
            <h3 className="parametros__titulo">Duraciones permitidas</h3>
            <div className="parametros__duraciones">
              {DURACIONES_OPCIONES.map((minutos) => (
                <label key={minutos} className="parametros__duracion">
                  <input
                    type="checkbox"
                    checked={borrador.duracionesPermitidas.includes(minutos)}
                    onChange={() => alternarDuracion(minutos)}
                  />
                  <span>{minutos} min</span>
                </label>
              ))}
            </div>
            <span className="parametros__hint">
              Se usan ya en la reserva: una clase solo puede durar una de estas opciones.
            </span>
          </div>

          <div className="parametros__bloque">
            <h3 className="parametros__titulo">Mensualidades</h3>
            <label className="parametros__campo">
              <span className="form__label">Vencimiento del crédito (días)</span>
              <input
                className="form__input"
                type="number"
                min="1"
                max={VENCIMIENTO_DIAS_MAX}
                placeholder="Sin vencimiento"
                value={borrador.vencimientoCreditoDias ?? ''}
                onChange={(e) =>
                  editarParametros({
                    vencimientoCreditoDias: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
              <span className="parametros__hint">Vacío = no vence.</span>
            </label>
            <label className="parametros__campo">
              <span className="form__label">Falta sin aviso con crédito</span>
              <select
                className="form__input"
                value={borrador.faltaSinAvisoConCredito}
                onChange={(e) => editarParametros({ faltaSinAvisoConCredito: e.target.value })}
              >
                {FALTAS_CREDITO.map((opcion) => (
                  <option key={opcion.valor} value={opcion.valor}>
                    {opcion.label}
                  </option>
                ))}
              </select>
              <span className="parametros__hint">
                Se aplica al cerrar la clase si el alumno faltó sin aviso y tiene crédito.
              </span>
            </label>
            <label className="parametros__check">
              <input
                type="checkbox"
                checked={borrador.creditoRequierePago}
                onChange={(e) => editarParametros({ creditoRequierePago: e.target.checked })}
              />
              <span>El crédito se puede usar solo cuando la mensualidad está pagada</span>
            </label>
            <span className="parametros__hint">
              Apagado: el crédito sirve apenas se compra el lote.
            </span>
          </div>

          <div className="parametros__bloque">
            <h3 className="parametros__titulo">Alertas de cobro</h3>
            <label className="parametros__campo">
              <span className="form__label">Avisar (días)</span>
              <input
                className="form__input"
                type="number"
                min="0"
                max={ALERTA_DIAS_MAX}
                value={borrador.alertaCobro.dias}
                onChange={(e) =>
                  editarParametros({
                    alertaCobro: { ...borrador.alertaCobro, dias: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label className="parametros__campo">
              <span className="form__label">Referencia</span>
              <select
                className="form__input"
                value={borrador.alertaCobro.referencia}
                onChange={(e) =>
                  editarParametros({
                    alertaCobro: { ...borrador.alertaCobro, referencia: e.target.value },
                  })
                }
              >
                {ALERTA_REFERENCIAS.map((opcion) => (
                  <option key={opcion.valor} value={opcion.valor}>
                    {opcion.label}
                  </option>
                ))}
              </select>
              <span className="parametros__hint">Se aplica en la fase de cobros.</span>
            </label>
          </div>

          <div className="parametros__bloque">
            <h3 className="parametros__titulo">Restricciones</h3>
            <label className="parametros__check">
              <input
                type="checkbox"
                checked={borrador.restringirCategoriaPorFranja}
                onChange={(e) =>
                  editarParametros({ restringirCategoriaPorFranja: e.target.checked })
                }
              />
              <span>Restringir la categoría según la franja horaria</span>
            </label>
            <span className="parametros__hint">Se aplica en una fase posterior.</span>
          </div>
        </div>

        {sucio ? (
          <div className="barra-cambios" role="status">
            <div className="barra-cambios__texto">
              <strong>Cambios sin guardar</strong>
              {errorParametros ? (
                <span className="barra-cambios__error" role="alert">
                  {errorParametros}
                </span>
              ) : null}
            </div>
            <div className="barra-cambios__acciones">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={guardando}
                onClick={descartarParametros}
              >
                Descartar
              </button>
              <button type="button" className="btn-cta" disabled={guardando} onClick={guardarParametros}>
                Guardar
              </button>
            </div>
          </div>
        ) : errorParametros ? (
          <p className="alert alert--error" role="alert">
            {errorParametros}
          </p>
        ) : null}
      </section>
    </div>
  )
}

/** Una fila de perfil: nombre, resumen, estado y menú de acciones. */
function FilaPerfil({ tenantId, perfil, uid, onChanged }) {
  const { mostrarExito, mostrarErrorTecnico, confirmar } = useAvisos()
  const [editando, setEditando] = useState(null)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const activo = perfil.activo !== false

  function abrirEdicion() {
    setError('')
    setEditando({ nombre: perfil.nombre, personas: perfil.personas, modo: perfil.modo })
  }

  async function guardar(event) {
    event.preventDefault()
    setGuardando(true)
    try {
      await actualizarPerfilCobro(
        db,
        tenantId,
        perfil.id,
        {
          nombre: editando.nombre,
          personas: editando.personas,
          modo: editando.modo,
        },
        { uid },
      )
      mostrarExito('Perfil guardado')
      setEditando(null)
      onChanged()
    } catch (err) {
      if (esErrorDeNegocio(err)) setError(err.message)
      else mostrarErrorTecnico('guardar-perfil', err)
    } finally {
      setGuardando(false)
    }
  }

  async function alternar() {
    if (activo) {
      const confirmado = await confirmar({
        titulo: '¿Desactivar perfil?',
        mensaje: `${perfil.nombre} dejará de ofrecerse al reservar. Las clases ya cobradas no cambian.`,
        textoCancelar: 'Cancelar',
        textoConfirmar: 'Desactivar',
      })
      if (!confirmado) return
    }
    setGuardando(true)
    try {
      await cambiarActivaPerfilCobro(db, tenantId, perfil.id, !activo, { uid })
      mostrarExito(`${perfil.nombre} ${activo ? 'desactivado' : 'reactivado'}`)
      onChanged()
    } catch (err) {
      mostrarErrorTecnico(activo ? 'desactivar-perfil' : 'reactivar-perfil', err)
    } finally {
      setGuardando(false)
    }
  }

  if (editando) {
    return (
      <li className="cancha-fila">
        <form className="perfil-form" onSubmit={guardar}>
          <input
            className="form__input form__input--compacto"
            aria-label={`Nombre del perfil ${perfil.nombre}`}
            value={editando.nombre}
            maxLength={LIMITE_NOMBRE_PERFIL}
            autoFocus
            disabled={guardando}
            onChange={(e) => {
              setEditando({ ...editando, nombre: e.target.value })
              setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setEditando(null)
                setError('')
              }
            }}
          />
          <div className="perfil-form__fila">
            <label className="perfil-form__campo">
              <span className="form__label">Personas</span>
              <select
                className="form__input form__input--compacto"
                value={editando.personas ?? ''}
                disabled={guardando}
                onChange={(e) =>
                  setEditando({
                    ...editando,
                    personas: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              >
                <option value="">Cualquiera</option>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="perfil-form__campo">
              <span className="form__label">Modo</span>
              <select
                className="form__input form__input--compacto"
                value={editando.modo}
                disabled={guardando}
                onChange={(e) => setEditando({ ...editando, modo: e.target.value })}
              >
                {MODOS_COBRO.map((valor) => (
                  <option key={valor} value={valor}>
                    {MODOS_LABEL[valor]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error ? (
            <p className="form__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="perfil-form__acciones">
            <button type="submit" className="btn" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setEditando(null)}>
              Cancelar
            </button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="cancha-fila">
      <span className="cancha-fila__nombre">
        {perfil.nombre}
        <span className="perfil-fila__hint">
          {resumenPersonas(perfil.personas)} · {MODOS_LABEL[perfil.modo]}
        </span>
      </span>
      <span className={`pill-estado${activo ? '' : ' is-off'}`}>
        {activo ? 'Activo' : 'Inactivo'}
      </span>
      <MenuAcciones
        etiqueta={`Acciones de ${perfil.nombre}`}
        items={[
          { clave: 'editar', etiqueta: 'Editar', onSelect: abrirEdicion },
          {
            clave: 'alternar',
            etiqueta: activo ? 'Desactivar' : 'Reactivar',
            onSelect: alternar,
          },
        ]}
      />
    </li>
  )
}

/** Alta de un perfil en línea: nombre, personas y modo. */
function AltaPerfil({ tenantId, uid, onCreated }) {
  const { mostrarExito, mostrarErrorTecnico } = useAvisos()
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [personas, setPersonas] = useState('')
  const [modo, setModo] = useState('total')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  function cerrar() {
    setAbierto(false)
    setNombre('')
    setPersonas('')
    setModo('total')
    setError('')
  }

  async function enviar(event) {
    event.preventDefault()
    setGuardando(true)
    try {
      await crearPerfilCobro(
        db,
        tenantId,
        { nombre, personas: personas === '' ? null : Number(personas), modo },
        { uid },
      )
      mostrarExito(`Perfil agregado: ${nombre}`)
      cerrar()
      onCreated()
    } catch (err) {
      if (esErrorDeNegocio(err)) setError(err.message)
      else mostrarErrorTecnico('crear-perfil', err)
    } finally {
      setGuardando(false)
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="btn btn--secondary" onClick={() => setAbierto(true)}>
        <PlusIcon size={16} /> Agregar perfil
      </button>
    )
  }

  return (
    <form className="perfil-form" onSubmit={enviar}>
      <input
        className="form__input form__input--compacto"
        aria-label="Nombre del perfil nuevo"
        placeholder="Nombre del perfil nuevo"
        value={nombre}
        autoFocus
        disabled={guardando}
        onChange={(e) => {
          setNombre(e.target.value)
          setError('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            cerrar()
          }
        }}
      />
      <div className="perfil-form__fila">
        <label className="perfil-form__campo">
          <span className="form__label">Personas</span>
          <select
            className="form__input form__input--compacto"
            value={personas}
            disabled={guardando}
            onChange={(e) => setPersonas(e.target.value)}
          >
            <option value="">Cualquiera</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="perfil-form__campo">
          <span className="form__label">Modo</span>
          <select
            className="form__input form__input--compacto"
            value={modo}
            disabled={guardando}
            onChange={(e) => setModo(e.target.value)}
          >
            {MODOS_COBRO.map((valor) => (
              <option key={valor} value={valor}>
                {MODOS_LABEL[valor]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="perfil-form__acciones">
        <button type="submit" className="btn" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Agregar'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={cerrar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
