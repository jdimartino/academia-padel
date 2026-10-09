import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import PageChrome from '../components/PageChrome'
import { ChevronDown, MoreIcon, PencilIcon, PlusIcon } from '../components/Icons'
import { useAuth } from '../context/AuthContext'
import { useAvisos } from '../context/AvisosContext'
import { db } from '../firebase/config'
import {
  cambiarActivaCancha,
  crearCancha,
  crearSede,
  desactivarSede,
  horarioDeSede,
  listarCanchas,
  listarSedes,
  nombreDeCancha,
  nombreDeSede,
  normalizarNombreCancha,
  reactivarSede,
  renombrarCancha,
  renombrarSede,
  setSedeHorario,
  validarHorario,
} from '../firebase/db'
import {
  DIAS_SEMANA,
  HORARIO_DEFAULT,
  MARCAS_EJE_HORARIO,
  MINUTOS_BLOQUE,
  MINUTOS_DIA,
  etiquetaDia,
  formatMinutos,
  fraccionEnEje,
  franjaValida,
  resumenDiaSede,
  resumenHoy,
  tramoEnEje,
} from '../lib/agenda'
import { esErrorDeNegocio, hayCambios } from '../lib/avisos'
import useMediaQuery from '../hooks/useMediaQuery'

/*
 * Horas que ofrecen los selectores de apertura y cierre: cada MINUTOS_BLOQUE
 * (30 min) desde las 00:00 hasta las 24:00. Los valores guardados son MINUTOS.
 * Las etiquetas son las del formateador de 12 h del proyecto ("7:30 AM"), sin
 * sufijos, para que el selector mida apenas lo que mide su contenido.
 */
const MINUTOS_HORA = Array.from(
  { length: MINUTOS_DIA / MINUTOS_BLOQUE + 1 },
  (_, i) => i * MINUTOS_BLOQUE,
)

const IDS_TABS = ['horario', 'canchas', 'general']

const MENSAJE_TECNICO_INLINE = 'No se pudo guardar. Inténtalo de nuevo.'

/* ------------------------------------------------------------------ */
/* Modelo del editor de horario                                        */
/* ------------------------------------------------------------------ */

/*
 * Estado editable del horario semanal de una sede: por cada día, si está
 * cerrado, sus minutos de apertura y cierre, y `ultima`: la última franja
 * ABIERTA que ese día tuvo en esta sesión de edición. Apagar y volver a
 * prender un día restaura `ultima`; un día que arrancó cerrado no tiene
 * ninguna y se abre con el horario por defecto de la sede.
 */
function editorDeSede(sede) {
  const semana = horarioDeSede(sede)
  return Object.fromEntries(
    DIAS_SEMANA.map((dia) => [
      dia,
      {
        cerrado: !semana[dia],
        apertura: semana[dia]?.apertura ?? HORARIO_DEFAULT.apertura,
        cierre: semana[dia]?.cierre ?? HORARIO_DEFAULT.cierre,
        ultima: semana[dia] ? { ...semana[dia] } : null,
      },
    ]),
  )
}

/** Horario semanal (0 = lunes … 6 = domingo) a partir del editor: null = cerrado. */
function horarioDelEditor(editor) {
  return Object.fromEntries(
    DIAS_SEMANA.map((dia) => [
      dia,
      editor[dia].cerrado
        ? null
        : { apertura: Number(editor[dia].apertura), cierre: Number(editor[dia].cierre) },
    ]),
  )
}

/** La primera franja abierta de un horario: su "horario por defecto". */
function franjaPorDefecto(semana) {
  for (const dia of DIAS_SEMANA) {
    if (semana[dia]) return { ...semana[dia] }
  }
  return { ...HORARIO_DEFAULT }
}

/*
 * ¿Ese día quedó inválido en el borrador? Usa `franjaValida`, que es el MISMO
 * chequeo puro que `validarHorario` (db.js) le aplica a cada día: la única
 * combinación inválida que pueden armar los selectores es cierre <= apertura.
 */
function diaInvalido(fila) {
  if (fila.cerrado) return false
  return (
    franjaValida({ apertura: Number(fila.apertura), cierre: Number(fila.cierre) }) === null
  )
}

/* ------------------------------------------------------------------ */
/* Piezas compartidas                                                  */
/* ------------------------------------------------------------------ */

/*
 * Botón "⋯" con un menú de acciones (desactivar/reactivar, renombrar…). El menú
 * va anclado al botón (nunca fixed, para no romper el scroll del celular) y se
 * cierra con Escape, al elegir una acción o al tocar fuera.
 */
function MenuAcciones({ etiqueta, items }) {
  const [abierto, setAbierto] = useState(false)
  const contenedorRef = useRef(null)

  useEffect(() => {
    if (!abierto) return undefined
    function alTeclear(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setAbierto(false)
      }
    }
    function alApuntar(event) {
      if (!contenedorRef.current?.contains(event.target)) setAbierto(false)
    }
    window.addEventListener('keydown', alTeclear, true)
    window.addEventListener('pointerdown', alApuntar)
    return () => {
      window.removeEventListener('keydown', alTeclear, true)
      window.removeEventListener('pointerdown', alApuntar)
    }
  }, [abierto])

  return (
    <div className="menu-ancla" ref={contenedorRef}>
      <button
        type="button"
        className="icon-btn"
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((valor) => !valor)}
      >
        <MoreIcon size={18} />
      </button>
      {abierto ? (
        <div className="menu-flotante glass-strong" role="menu" aria-label={etiqueta}>
          {items.map((item) => (
            <button
              key={item.clave ?? item.etiqueta}
              type="button"
              role="menuitem"
              className="menu-flotante__item"
              onClick={() => {
                setAbierto(false)
                item.onSelect()
              }}
            >
              {item.etiqueta}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Una sede en la lista (desktop) o en el selector (mobile). */
function ItemSede({ sede, canchas, seleccionada, onSeleccionar }) {
  const nombre = nombreDeSede(sede, sede.id)
  const inactiva = sede.activa === false
  return (
    <li>
      <button
        type="button"
        className={`item-sede${seleccionada ? ' is-sel' : ''}${inactiva ? ' is-inactiva' : ''}`}
        aria-current={seleccionada ? 'true' : undefined}
        onClick={onSeleccionar}
      >
        <span className={`item-sede__punto${inactiva ? ' is-off' : ''}`} aria-hidden="true" />
        <span className="item-sede__texto">
          <span className="item-sede__nombre">{nombre}</span>
          <span className="item-sede__resumen">{resumenHoy(sede, canchas)}</span>
        </span>
      </button>
    </li>
  )
}

/*
 * Lista de sedes: cabecera "Sedes" con el "+" que abre el alta en línea
 * (Enter guarda, Escape cancela, los errores van debajo del campo) y las sedes
 * activas primero, con las inactivas al final y atenuadas.
 */
function ListaSedes({ sedes, seleccionadaId, onSeleccionar, onCrear }) {
  const [creando, setCreando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const activas = sedes.filter((sede) => sede.activa !== false)
  const inactivas = sedes.filter((sede) => sede.activa === false)
  const ordenadas = [...activas, ...inactivas]

  function cerrarAlta() {
    setCreando(false)
    setNombre('')
    setError('')
  }

  async function enviar(event) {
    event.preventDefault()
    setGuardando(true)
    const mensaje = await onCrear(nombre)
    setGuardando(false)
    if (mensaje) {
      setError(mensaje)
      return
    }
    cerrarAlta()
  }

  return (
    <div className="lista-sedes">
      <div className="lista-sedes__cab">
        <h2 className="lista-sedes__titulo">Sedes</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Nueva sede"
          aria-expanded={creando}
          onClick={() => (creando ? cerrarAlta() : setCreando(true))}
        >
          <PlusIcon size={18} />
        </button>
      </div>

      {creando ? (
        <form className="lista-sedes__alta" onSubmit={enviar}>
          <input
            className="form__input form__input--compacto"
            aria-label="Nombre de la sede nueva"
            placeholder="Nombre de la sede nueva"
            value={nombre}
            autoFocus
            disabled={guardando}
            onChange={(event) => {
              setNombre(event.target.value)
              setError('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                cerrarAlta()
              }
            }}
          />
          {error ? (
            <p className="form__error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}

      {ordenadas.length === 0 ? (
        <p className="aviso">Esta academia todavía no tiene sedes.</p>
      ) : (
        <ul className="lista-sedes__items">
          {ordenadas.map((sede) => (
            <ItemSede
              key={sede.id}
              sede={sede}
              canchas={sede.canchas ?? []}
              seleccionada={sede.id === seleccionadaId}
              onSeleccionar={() => onSeleccionar(sede.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Formulario en línea del nombre de la sede (header desktop y pestaña General). */
function FormNombreSede({ valor, error, disabled, onChange, onSubmit, onCancelar }) {
  return (
    <form className="nombre-form" onSubmit={onSubmit}>
      <input
        className="form__input form__input--compacto"
        aria-label="Nombre de la sede"
        value={valor}
        autoFocus
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancelar()
          }
        }}
      />
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Detalle de la sede                                                  */
/* ------------------------------------------------------------------ */

/*
 * Detalle de la sede elegida: encabezado con renombre en línea y menú "⋯",
 * pestañas (Horario / Canchas / General) y, en Horario, el editor semanal
 * compacto con la barra de cambios sin guardar.
 *
 * El borrador del horario vive acá y no se pierde al cambiar de pestaña; el
 * componente se remonta solo cuando cambia de sede (key = id), así que cada
 * sede arranca de lo guardado.
 */
function DetalleSede({ tenantId, sede, canchas, onChanged, onSucio, onAlternarSede }) {
  const { user } = useAuth()
  const { mostrarExito, mostrarErrorTecnico, confirmar } = useAvisos()
  const esDesktop = useMediaQuery('(min-width: 48rem)')
  const uid = user?.uid ?? null

  const nombre = nombreDeSede(sede, sede.id)
  const activa = sede.activa !== false

  /*
   * `guardado` es el horario tal como quedó en Firestore (la base del "hay
   * cambios") y `editor` el borrador. Se siembran al montar —el componente se
   * remonta por `key` cuando cambia de sede— y `guardado` se actualiza al
   * guardar; nadie más escribe el horario de la sede.
   */
  const [guardado, setGuardado] = useState(() => horarioDeSede(sede))
  const [editor, setEditor] = useState(() => editorDeSede(sede))
  const franjaSede = useMemo(() => franjaPorDefecto(guardado), [guardado])

  const [tab, setTab] = useState('horario')
  const [diaExpandido, setDiaExpandido] = useState(null)
  const [errorHorario, setErrorHorario] = useState('')
  const [guardandoHorario, setGuardandoHorario] = useState(false)

  const [editandoNombre, setEditandoNombre] = useState(false)
  const [nombreDraft, setNombreDraft] = useState(nombre)
  const [errorNombre, setErrorNombre] = useState('')

  const [nuevoNombreCancha, setNuevoNombreCancha] = useState('')
  const [errorNuevaCancha, setErrorNuevaCancha] = useState('')
  const [renombrando, setRenombrando] = useState(null)
  const [errorRenombre, setErrorRenombre] = useState('')
  const [enviando, setEnviando] = useState(false)

  const borrador = useMemo(() => horarioDelEditor(editor), [editor])
  const sucio = useMemo(() => hayCambios(guardado, borrador), [guardado, borrador])

  useEffect(() => {
    onSucio(sucio)
  }, [sucio, onSucio])

  function cambiarDia(dia, cambios) {
    setErrorHorario('')
    setEditor((prev) => {
      const fila = { ...prev[dia], ...cambios }
      if (!fila.cerrado) {
        fila.ultima = { apertura: Number(fila.apertura), cierre: Number(fila.cierre) }
      }
      return { ...prev, [dia]: fila }
    })
  }

  /** Prende o apaga el día. Al prenderlo recupera su última franja. */
  function alternarDia(dia) {
    setErrorHorario('')
    const fila = editor[dia]
    if (!fila.cerrado) setDiaExpandido((actual) => (actual === dia ? null : actual))
    setEditor((prev) => {
      const actual = prev[dia]
      if (!actual.cerrado) return { ...prev, [dia]: { ...actual, cerrado: true } }
      const volver = franjaValida(actual.ultima) ?? franjaSede
      return {
        ...prev,
        [dia]: {
          ...actual,
          cerrado: false,
          apertura: volver.apertura,
          cierre: volver.cierre,
          ultima: volver,
        },
      }
    })
  }

  function descartarHorario() {
    setEditor(editorDeSede({ horario: guardado }))
    setErrorHorario('')
    setDiaExpandido(null)
  }

  async function guardarHorario() {
    const horario = horarioDelEditor(editor)
    try {
      validarHorario(horario)
    } catch {
      setErrorHorario('Corrige el horario marcado')
      return
    }

    setGuardandoHorario(true)
    setErrorHorario('')
    try {
      const resultado = await setSedeHorario(db, tenantId, sede.id, horario, { uid })
      const normalizado = horarioDeSede({ horario: resultado.horario })
      setGuardado(normalizado)
      setEditor(editorDeSede({ horario: normalizado }))
      mostrarExito(`Horario de ${nombre} guardado`)
      onChanged()
    } catch (err) {
      if (esErrorDeNegocio(err)) {
        setErrorHorario(err.message)
      } else {
        setErrorHorario(MENSAJE_TECNICO_INLINE)
        mostrarErrorTecnico('guardar-horario', err)
      }
    } finally {
      setGuardandoHorario(false)
    }
  }

  async function cambiarTab(nuevo) {
    if (nuevo === tab) return
    if (sucio) {
      const descartar = await confirmar({
        titulo: '¿Descartar cambios?',
        mensaje: 'Tienes cambios sin guardar en el horario.',
        textoCancelar: 'Seguir editando',
        textoConfirmar: 'Descartar cambios',
      })
      if (!descartar) return
      descartarHorario()
    }
    setTab(nuevo)
  }

  /** Flechas/Inicio/Fin en la fila de pestañas (patrón ARIA de tablist). */
  function alTeclearTabs(event) {
    const paso = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!paso && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const actual = IDS_TABS.indexOf(tab)
    let siguiente = actual
    if (event.key === 'Home') siguiente = 0
    else if (event.key === 'End') siguiente = IDS_TABS.length - 1
    else siguiente = (actual + paso + IDS_TABS.length) % IDS_TABS.length
    cambiarTab(IDS_TABS[siguiente])
  }

  function abrirRenombre() {
    setNombreDraft(nombre)
    setErrorNombre('')
    setEditandoNombre(true)
  }

  async function guardarNombre(event) {
    event.preventDefault()
    setEnviando(true)
    try {
      const guardado = await renombrarSede(db, tenantId, sede.id, nombreDraft, { uid })
      mostrarExito(`Nombre guardado: ${guardado.nombre}`)
      setEditandoNombre(false)
      setErrorNombre('')
      onChanged()
    } catch (err) {
      if (esErrorDeNegocio(err)) setErrorNombre(err.message)
      else mostrarErrorTecnico('renombrar-sede', err)
    } finally {
      setEnviando(false)
    }
  }

  async function agregarCancha(event) {
    event.preventDefault()
    setEnviando(true)
    try {
      await crearCancha(db, tenantId, sede.id, { nombre: nuevoNombreCancha }, { uid })
      mostrarExito(`${normalizarNombreCancha(nuevoNombreCancha)} agregada`)
      setNuevoNombreCancha('')
      setErrorNuevaCancha('')
      onChanged()
    } catch (err) {
      if (esErrorDeNegocio(err)) setErrorNuevaCancha(err.message)
      else mostrarErrorTecnico('crear-cancha', err)
    } finally {
      setEnviando(false)
    }
  }

  async function guardarNombreCancha(event) {
    event.preventDefault()
    if (!renombrando) return
    const cancha = canchas.find((c) => c.id === renombrando.id)
    if (!cancha) return
    setEnviando(true)
    try {
      const guardado = await renombrarCancha(db, tenantId, sede.id, cancha.id, renombrando.valor, {
        uid,
      })
      mostrarExito(`Nombre guardado: ${guardado.nombre}`)
      setRenombrando(null)
      setErrorRenombre('')
      onChanged()
    } catch (err) {
      if (esErrorDeNegocio(err)) setErrorRenombre(err.message)
      else mostrarErrorTecnico('renombrar-cancha', err)
    } finally {
      setEnviando(false)
    }
  }

  async function alternarCancha(cancha) {
    const nombreCancha = nombreDeCancha(cancha, cancha.id)
    const activar = cancha.activa === false
    setEnviando(true)
    try {
      await cambiarActivaCancha(db, tenantId, sede.id, cancha.id, activar, { uid })
      mostrarExito(`${nombreCancha} ${activar ? 'activada' : 'desactivada'}`)
      onChanged()
    } catch (err) {
      mostrarErrorTecnico(activar ? 'activar-cancha' : 'desactivar-cancha', err)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="detalle glass" aria-label={`Configuración de ${nombre}`}>
      <header className="detalle__cab">
        {editandoNombre && esDesktop ? (
          <FormNombreSede
            valor={nombreDraft}
            error={errorNombre}
            disabled={enviando}
            onChange={(valor) => {
              setNombreDraft(valor)
              setErrorNombre('')
            }}
            onSubmit={guardarNombre}
            onCancelar={() => {
              setEditandoNombre(false)
              setErrorNombre('')
            }}
          />
        ) : (
          <>
            <h2 className="detalle__nombre">
              {nombre}
              {!activa ? <span className="detalle__inactiva">Inactiva</span> : null}
            </h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="Renombrar"
              onClick={abrirRenombre}
            >
              <PencilIcon size={16} />
            </button>
          </>
        )}
        <MenuAcciones
          etiqueta="Acciones de la sede"
          items={[
            {
              clave: 'alternar',
              etiqueta: activa ? 'Desactivar sede' : 'Reactivar sede',
              onSelect: onAlternarSede,
            },
          ]}
        />
      </header>

      <div className="detalle__tabs" role="tablist" aria-label="Secciones de la sede" onKeyDown={alTeclearTabs}>
        {[
          { id: 'horario', etiqueta: 'Horario' },
          { id: 'canchas', etiqueta: `Canchas (${canchas.length})` },
          { id: 'general', etiqueta: 'General' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            className={`detalle__tab${tab === item.id ? ' is-sel' : ''}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => cambiarTab(item.id)}
          >
            {item.etiqueta}
          </button>
        ))}
      </div>

      {tab === 'horario' ? (
        <div
          className="detalle__panel"
          role="tabpanel"
          id="panel-horario"
          aria-labelledby="tab-horario"
        >
          <div className="horario-rejilla">
            <div className="horario-eje" aria-hidden="true">
              <span />
              <span />
              <span />
              <div className="horario-eje__marcas">
                {MARCAS_EJE_HORARIO.map((marca, i) => {
                  const ultima = i === MARCAS_EJE_HORARIO.length - 1
                  const estilo =
                    i === 0
                      ? { left: 0 }
                      : ultima
                        ? { right: 0 }
                        : { left: `${(fraccionEnEje(marca.minutos) ?? 0) * 100}%`, transform: 'translateX(-50%)' }
                  return (
                    <span key={marca.etiqueta} className="horario-eje__marca" style={estilo}>
                      {marca.etiqueta}
                    </span>
                  )
                })}
              </div>
            </div>

            {DIAS_SEMANA.map((dia) => {
              const fila = editor[dia]
              const etiqueta = etiquetaDia(dia)
              const invalido = diaInvalido(fila)
              const tramo =
                fila.cerrado || invalido
                  ? null
                  : tramoEnEje({
                      apertura: Number(fila.apertura),
                      cierre: Number(fila.cierre),
                    })
              return (
                <div className={`horario-dia${invalido ? ' is-error' : ''}`} key={dia}>
                  <span className="horario-dia__nombre">{etiqueta}</span>

                  <div className="horario-dia__rango">
                    {fila.cerrado ? (
                      <span className="horario-dia__rango-texto">Cerrado</span>
                    ) : (
                      <button
                        type="button"
                        className="horario-dia__rango-btn"
                        aria-expanded={diaExpandido === dia}
                        aria-controls={`dia-${sede.id}-${dia}`}
                        onClick={() => setDiaExpandido((actual) => (actual === dia ? null : dia))}
                      >
                        {formatMinutos(Number(fila.apertura))} –{' '}
                        {formatMinutos(Number(fila.cierre))}
                      </button>
                    )}
                  </div>

                  <label className="switch-celda">
                    <input
                      type="checkbox"
                      role="switch"
                      className="switch"
                      aria-label={`Abierto ${etiqueta}`}
                      checked={!fila.cerrado}
                      onChange={() => alternarDia(dia)}
                    />
                  </label>

                  <div
                    className={`horario-dia__horas${diaExpandido === dia ? ' is-abierto' : ''}`}
                    id={`dia-${sede.id}-${dia}`}
                  >
                    {fila.cerrado ? (
                      <span className="horario-dia__cerrado">Cerrado</span>
                    ) : (
                      <>
                        <label
                          className="visually-hidden"
                          htmlFor={`apertura-${sede.id}-${dia}`}
                        >
                          Apertura del {etiqueta.toLowerCase()}
                        </label>
                        <select
                          className="form__input form__input--hora"
                          id={`apertura-${sede.id}-${dia}`}
                          value={fila.apertura}
                          onChange={(event) =>
                            cambiarDia(dia, { apertura: Number(event.target.value) })
                          }
                        >
                          {MINUTOS_HORA.map((minutos) => (
                            <option key={minutos} value={minutos}>
                              {formatMinutos(minutos)}
                            </option>
                          ))}
                        </select>
                        <span aria-hidden="true">–</span>
                        <label
                          className="visually-hidden"
                          htmlFor={`cierre-${sede.id}-${dia}`}
                        >
                          Cierre del {etiqueta.toLowerCase()}
                        </label>
                        <select
                          className="form__input form__input--hora"
                          id={`cierre-${sede.id}-${dia}`}
                          value={fila.cierre}
                          onChange={(event) =>
                            cambiarDia(dia, { cierre: Number(event.target.value) })
                          }
                        >
                          {MINUTOS_HORA.map((minutos) => (
                            <option key={minutos} value={minutos}>
                              {formatMinutos(minutos)}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>

                  <div className="horario-dia__barra" aria-hidden="true">
                    {tramo ? (
                      <span
                        className="horario-dia__tramo"
                        style={{
                          left: `${tramo.izquierda * 100}%`,
                          width: `${tramo.ancho * 100}%`,
                        }}
                      />
                    ) : null}
                  </div>

                  {invalido ? (
                    <p className="horario-dia__error" role="alert">
                      El cierre debe ser después de la apertura
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>

          {sucio ? (
            <div className="barra-cambios" role="status">
              <div className="barra-cambios__texto">
                <strong>Cambios sin guardar</strong>
                {errorHorario ? (
                  <span className="barra-cambios__error" role="alert">
                    {errorHorario}
                  </span>
                ) : null}
              </div>
              <div className="barra-cambios__acciones">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={guardandoHorario}
                  onClick={descartarHorario}
                >
                  Descartar
                </button>
                <button
                  type="button"
                  className="btn-cta"
                  disabled={guardandoHorario}
                  onClick={guardarHorario}
                >
                  Guardar
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'canchas' ? (
        <div
          className="detalle__panel"
          role="tabpanel"
          id="panel-canchas"
          aria-labelledby="tab-canchas"
        >
          {canchas.length === 0 ? (
            <p className="aviso">Esta sede todavía no tiene canchas.</p>
          ) : (
            <ul className="canchas-lista">
              {canchas.map((cancha) => {
                const nombreCancha = nombreDeCancha(cancha, cancha.id)
                const canchaActiva = cancha.activa !== false
                const editando = renombrando?.id === cancha.id
                return (
                  <li className="cancha-fila" key={cancha.id}>
                    {editando ? (
                      <form className="nombre-form" onSubmit={guardarNombreCancha}>
                        <input
                          className="form__input form__input--compacto"
                          aria-label={`Nombre de la cancha ${nombreCancha}`}
                          value={renombrando.valor}
                          autoFocus
                          disabled={enviando}
                          onChange={(event) => {
                            setRenombrando({ id: cancha.id, valor: event.target.value })
                            setErrorRenombre('')
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              setRenombrando(null)
                              setErrorRenombre('')
                            }
                          }}
                        />
                        {errorRenombre ? (
                          <p className="form__error" role="alert">
                            {errorRenombre}
                          </p>
                        ) : null}
                      </form>
                    ) : (
                      <span className="cancha-fila__nombre">{nombreCancha}</span>
                    )}

                    <span className={`pill-estado${canchaActiva ? '' : ' is-off'}`}>
                      {canchaActiva ? 'Activa' : 'Inactiva'}
                    </span>

                    {editando ? null : (
                      <MenuAcciones
                        etiqueta={`Acciones de ${nombreCancha}`}
                        items={[
                          {
                            clave: 'renombrar',
                            etiqueta: 'Renombrar',
                            onSelect: () => {
                              setErrorRenombre('')
                              setRenombrando({ id: cancha.id, valor: nombreCancha })
                            },
                          },
                          {
                            clave: 'alternar',
                            etiqueta: canchaActiva ? 'Desactivar' : 'Reactivar',
                            onSelect: () => alternarCancha(cancha),
                          },
                        ]}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <form className="canchas-nueva" onSubmit={agregarCancha}>
            <input
              className="form__input"
              aria-label="Nombre de la cancha nueva"
              placeholder="Nombre de la cancha nueva"
              value={nuevoNombreCancha}
              disabled={enviando}
              onChange={(event) => {
                setNuevoNombreCancha(event.target.value)
                setErrorNuevaCancha('')
              }}
            />
            <button type="submit" className="btn btn--secondary" disabled={enviando}>
              + Agregar
            </button>
            {errorNuevaCancha ? (
              <p className="form__error canchas-nueva__error" role="alert">
                {errorNuevaCancha}
              </p>
            ) : null}
          </form>
        </div>
      ) : null}

      {tab === 'general' ? (
        <div
          className="detalle__panel general"
          role="tabpanel"
          id="panel-general"
          aria-labelledby="tab-general"
        >
          <div className="general__bloque">
            <span className="general__label">Nombre</span>
            {editandoNombre && !esDesktop ? (
              <FormNombreSede
                valor={nombreDraft}
                error={errorNombre}
                disabled={enviando}
                onChange={(valor) => {
                  setNombreDraft(valor)
                  setErrorNombre('')
                }}
                onSubmit={guardarNombre}
                onCancelar={() => {
                  setEditandoNombre(false)
                  setErrorNombre('')
                }}
              />
            ) : (
              <div className="general__estado">
                <span className="general__valor">{nombre}</span>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={enviando}
                  onClick={abrirRenombre}
                >
                  Renombrar
                </button>
              </div>
            )}
          </div>

          <div className="general__bloque">
            <span className="general__label">Estado</span>
            <div className="general__estado">
              <span className="general__nota">
                {activa
                  ? 'Activa · admite reservas en sus canchas'
                  : 'Inactiva · no aparece en la agenda'}
              </span>
              <button
                type="button"
                className="btn btn--secondary"
                disabled={enviando}
                onClick={onAlternarSede}
              >
                {activa ? 'Desactivar sede' : 'Reactivar sede'}
              </button>
            </div>
          </div>

          <p className="general__nota">
            Los precios de esta sede se van a configurar acá en una próxima fase.
          </p>
        </div>
      ) : null}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Pantalla                                                            */
/* ------------------------------------------------------------------ */

/*
 * Pantalla de Configuración: "Sedes y canchas". Lee TODAS las sedes del tenant
 * (incluidas las inactivas, para poder reactivarlas) y, para cada una, sus
 * canchas (también las inactivas). Todas las lecturas están acotadas por
 * tenant + sede. La sede elegida vive en la URL (?sede=<id>) y el default es la
 * primera activa.
 */
export default function Configuracion() {
  const { academia } = useParams()
  const { user } = useAuth()
  const { mostrarExito, mostrarErrorTecnico, confirmar } = useAvisos()
  const [searchParams, setSearchParams] = useSearchParams()
  // `null` = todavía no cargó.
  const [sedes, setSedes] = useState(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [listaAbierta, setListaAbierta] = useState(false)
  // "Hay cambios sin guardar en el horario": lo reporta el detalle y lo usa el
  // guardia al cambiar de sede.
  const sucioRef = useRef(false)

  const uid = user?.uid ?? null

  useEffect(() => {
    let activo = true
    async function cargar() {
      try {
        const lista = await listarSedes(db, academia)
        const canchas = await Promise.all(lista.map((sede) => listarCanchas(db, academia, sede.id)))
        if (!activo) return
        setSedes(lista.map((sede, i) => ({ ...sede, canchas: canchas[i] })))
        setError('')
      } catch (err) {
        if (!activo) return
        setSedes([])
        setError(err.message)
      }
    }
    cargar()
    return () => {
      activo = false
    }
  }, [academia, version])

  const recargar = useCallback(() => setVersion((valor) => valor + 1), [])
  const reportarSucio = useCallback((valor) => {
    sucioRef.current = valor
  }, [])

  const lista = sedes ?? []
  const sedeUrl = searchParams.get('sede')
  const activas = lista.filter((sede) => sede.activa !== false)
  const inactivas = lista.filter((sede) => sede.activa === false)
  const sedeSel =
    lista.find((sede) => sede.id === sedeUrl) ?? activas[0] ?? inactivas[0] ?? null

  // La sede elegida queda en la URL para que un reload la conserve.
  useEffect(() => {
    if (!sedeSel || sedeUrl === sedeSel.id) return
    const siguiente = new URLSearchParams(searchParams)
    siguiente.set('sede', sedeSel.id)
    setSearchParams(siguiente, { replace: true })
  }, [sedeSel, sedeUrl, searchParams, setSearchParams])

  function seleccionarSede(id) {
    setListaAbierta(false)
    if (id === sedeSel?.id) return
    if (sucioRef.current) {
      return confirmar({
        titulo: '¿Descartar cambios?',
        mensaje: 'Tienes cambios sin guardar en el horario.',
        textoCancelar: 'Seguir editando',
        textoConfirmar: 'Descartar cambios',
      }).then((descartar) => {
        if (!descartar) return
        sucioRef.current = false
        const siguiente = new URLSearchParams(searchParams)
        siguiente.set('sede', id)
        setSearchParams(siguiente, { replace: true })
      })
    }
    const siguiente = new URLSearchParams(searchParams)
    siguiente.set('sede', id)
    setSearchParams(siguiente, { replace: true })
    return undefined
  }

  /**
   * Crea una sede y recarga la lista. Devuelve el mensaje de error ('' si
   * salió bien). No cambia la sede elegida: la nueva aparece en la lista (al
   * final de las activas) y el usuario la abre cuando quiera, así el reload y
   * la sede del query string nunca se pisan.
   */
  async function crearSedeNueva(nombre) {
    try {
      await crearSede(db, academia, { nombre }, { uid })
      mostrarExito(`Sede agregada: ${normalizarNombreCancha(nombre)}`)
      recargar()
      return ''
    } catch (err) {
      if (esErrorDeNegocio(err)) return err.message
      mostrarErrorTecnico('crear-sede', err)
      return MENSAJE_TECNICO_INLINE
    }
  }

  /** Desactiva (con confirmación) o reactiva la sede elegida. */
  async function alternarSede() {
    if (!sedeSel) return
    const nombre = nombreDeSede(sedeSel, sedeSel.id)
    const reactivar = sedeSel.activa === false
    if (!reactivar) {
      const confirmado = await confirmar({
        titulo: '¿Desactivar sede?',
        mensaje: `${nombre} dejará de aparecer en la agenda y no admitirá reservas nuevas.`,
        textoCancelar: 'Cancelar',
        textoConfirmar: 'Desactivar',
      })
      if (!confirmado) return
    }
    try {
      if (reactivar) await reactivarSede(db, academia, sedeSel.id, { uid })
      else await desactivarSede(db, academia, sedeSel.id, { uid })
      mostrarExito(`${nombre} ${reactivar ? 'activada' : 'desactivada'}`)
      recargar()
    } catch (err) {
      mostrarErrorTecnico(reactivar ? 'activar-sede' : 'desactivar-sede', err)
    }
  }

  const itemsMenuSede = sedeSel
    ? [
        {
          clave: 'alternar',
          etiqueta: sedeSel.activa === false ? 'Reactivar sede' : 'Desactivar sede',
          onSelect: alternarSede,
        },
      ]
    : []

  return (
    <PageChrome titulo="Configuración">
      <div className="config">
        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        {sedes === null ? <p className="aviso glass">Cargando sedes…</p> : null}

        {sedes !== null ? (
          <>
            {sedeSel ? (
              <div className="config__selector">
                <button
                  type="button"
                  className="config__selector-btn"
                  aria-expanded={listaAbierta}
                  aria-controls="lista-sedes-movil"
                  onClick={() => setListaAbierta((valor) => !valor)}
                >
                  <span className="config__selector-texto">
                    <span className="config__selector-nombre">
                      {nombreDeSede(sedeSel, sedeSel.id)}
                    </span>
                    <span className="config__selector-hoy">{resumenDiaSede(sedeSel)}</span>
                  </span>
                  <ChevronDown size={18} />
                </button>
                <MenuAcciones etiqueta="Acciones de la sede" items={itemsMenuSede} />
                {listaAbierta ? (
                  <div className="config__selector-lista glass-strong" id="lista-sedes-movil">
                    <ListaSedes
                      sedes={lista}
                      seleccionadaId={sedeSel.id}
                      onSeleccionar={seleccionarSede}
                      onCrear={crearSedeNueva}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <aside className="config__lista glass" aria-label="Sedes">
              <ListaSedes
                sedes={lista}
                seleccionadaId={sedeSel?.id ?? null}
                onSeleccionar={seleccionarSede}
                onCrear={crearSedeNueva}
              />
            </aside>

            {sedeSel ? (
              <DetalleSede
                key={sedeSel.id}
                tenantId={academia}
                sede={sedeSel}
                canchas={sedeSel.canchas ?? []}
                onChanged={recargar}
                onSucio={reportarSucio}
                onAlternarSede={alternarSede}
              />
            ) : (
              <section className="detalle glass" aria-label="Sedes">
                <p className="aviso">Esta academia todavía no tiene sedes.</p>
              </section>
            )}
          </>
        ) : null}
      </div>
    </PageChrome>
  )
}
