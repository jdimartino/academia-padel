import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import PageChrome from '../components/PageChrome'
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
  MINUTOS_BLOQUE,
  MINUTOS_DIA,
  etiquetaDia,
  formatMinutos,
} from '../lib/agenda'

/*
 * Horas que ofrecen los selectores de apertura y cierre: cada MINUTOS_BLOQUE
 * (30 min) desde las 00:00 hasta las 24:00. Los valores guardados son MINUTOS.
 */
const MINUTOS_HORA = Array.from(
  { length: MINUTOS_DIA / MINUTOS_BLOQUE + 1 },
  (_, i) => i * MINUTOS_BLOQUE,
)

/** Etiqueta visible de un minuto del día: 12 h con AM/PM. Las dos medianoches
 * (00:00 y 24:00) se aclaran para no confundirlas en el selector. */
const etiquetaMinutos = (minutos) => {
  if (minutos === 0) return `${formatMinutos(minutos)} (inicio del día)`
  if (minutos === MINUTOS_DIA) return `${formatMinutos(minutos)} (medianoche)`
  return formatMinutos(minutos)
}

/**
 * Estado editable del horario semanal de una sede: por cada día, si está
 * cerrado y sus minutos de apertura y cierre. Un día cerrado conserva las horas
 * para que destildar "cerrado" no pierda lo que había.
 */
function editorDeSede(sede) {
  const semana = horarioDeSede(sede)
  return Object.fromEntries(
    DIAS_SEMANA.map((dia) => [
      dia,
      semana[dia]
        ? { cerrado: false, apertura: semana[dia].apertura, cierre: semana[dia].cierre }
        : { cerrado: true, apertura: HORARIO_DEFAULT.apertura, cierre: HORARIO_DEFAULT.cierre },
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

/*
 * Configuración de una sede: su nombre, su horario POR DÍA (cerrado / apertura /
 * cierre en medias horas) y sus canchas (agregar, renombrar y
 * activar/desactivar; nunca se borran). Cada escritura avisa por diálogo si
 * falla y por toast si sale bien.
 */
function SedeCard({ tenantId, sede, canchas, onChanged }) {
  const { user } = useAuth()
  const { mostrarErrorTecnico, mostrarExito } = useAvisos()
  const uid = user?.uid ?? null
  const nombreActual = nombreDeSede(sede, sede.id)
  const [editor, setEditor] = useState(() => editorDeSede(sede))
  const [nombreSede, setNombreSede] = useState(nombreActual)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [renombres, setRenombres] = useState({})
  const [enviando, setEnviando] = useState(false)

  const horario = useMemo(() => horarioDelEditor(editor), [editor])
  const problemaHorario = useMemo(() => {
    try {
      validarHorario(horario)
      return ''
    } catch (err) {
      return err.message
    }
  }, [horario])

  /**
   * Corre una escritura de la sede y recarga. `accion` es la clave del aviso,
   * `exito` el mensaje del toast (texto o función del resultado). Devuelve el
   * resultado de la escritura, o null si falló.
   */
  async function ejecutar(accion, tarea, exito) {
    setEnviando(true)
    try {
      const resultado = await tarea()
      mostrarExito(typeof exito === 'function' ? exito(resultado) : exito)
      onChanged()
      return resultado
    } catch (err) {
      mostrarErrorTecnico(accion, err)
      return null
    } finally {
      setEnviando(false)
    }
  }

  function cambiarDia(dia, cambios) {
    setEditor((prev) => ({ ...prev, [dia]: { ...prev[dia], ...cambios } }))
  }

  /** Copia el horario (cerrado u horas) de un día al resto de la semana. */
  function aplicarATodos(dia) {
    setEditor((prev) =>
      Object.fromEntries(DIAS_SEMANA.map((otro) => [otro, { ...prev[dia] }])),
    )
  }

  function guardarHorario(event) {
    event.preventDefault()
    if (problemaHorario) return
    ejecutar(
      'guardar-horario',
      () => setSedeHorario(db, tenantId, sede.id, horario, { uid }),
      `Horario de ${nombreActual} guardado`,
    )
  }

  async function guardarNombreSede(event) {
    event.preventDefault()
    await ejecutar(
      'renombrar-sede',
      () => renombrarSede(db, tenantId, sede.id, nombreSede, { uid }),
      (guardado) => `Nombre guardado: ${guardado.nombre}`,
    )
  }

  function alternarSede() {
    const activar = sede.activa === false
    ejecutar(
      activar ? 'activar-sede' : 'desactivar-sede',
      () => (activar ? reactivarSede(db, tenantId, sede.id, { uid }) : desactivarSede(db, tenantId, sede.id, { uid })),
      `${nombreActual} ${activar ? 'activada' : 'desactivada'}`,
    )
  }

  async function agregarCancha(event) {
    event.preventDefault()
    const ok = await ejecutar(
      'crear-cancha',
      () => crearCancha(db, tenantId, sede.id, { nombre: nuevoNombre }, { uid }),
      `${normalizarNombreCancha(nuevoNombre)} agregada`,
    )
    if (ok) setNuevoNombre('')
  }

  async function guardarNombreCancha(cancha) {
    const valor = renombres[cancha.id] ?? nombreDeCancha(cancha, cancha.id)
    const resultado = await ejecutar(
      'renombrar-cancha',
      () => renombrarCancha(db, tenantId, sede.id, cancha.id, valor, { uid }),
      (guardado) => `Nombre guardado: ${guardado.nombre}`,
    )
    if (resultado) {
      setRenombres((prev) => {
        const siguiente = { ...prev }
        delete siguiente[cancha.id]
        return siguiente
      })
    }
  }

  function alternarCancha(cancha) {
    const nombre = nombreDeCancha(cancha, cancha.id)
    const activar = cancha.activa === false
    ejecutar(
      activar ? 'activar-cancha' : 'desactivar-cancha',
      () => cambiarActivaCancha(db, tenantId, sede.id, cancha.id, activar, { uid }),
      `${nombre} ${activar ? 'activada' : 'desactivada'}`,
    )
  }

  return (
    <section className="representante-box" aria-label={`Sede ${nombreActual}`}>
      <h2 className="form__label">
        {nombreActual}
        {sede.activa === false ? ' · inactiva' : ''}
      </h2>

      <form className="fichas__barra" onSubmit={guardarNombreSede}>
        <input
          className="form__input"
          aria-label={`Nombre de la sede ${nombreActual}`}
          value={nombreSede}
          onChange={(event) => setNombreSede(event.target.value)}
        />
        <button className="btn btn--secondary" type="submit" disabled={enviando}>
          Guardar nombre
        </button>
      </form>

      <div className="fichas__barra">
        <span className="fichas__contador">
          {sede.activa === false
            ? 'Inactiva · no aparece en la agenda'
            : 'Activa · admite reservas en sus canchas'}
        </span>
        <button className="btn btn--secondary" type="button" disabled={enviando} onClick={alternarSede}>
          {sede.activa === false ? 'Activar' : 'Desactivar'}
        </button>
      </div>

      <form onSubmit={guardarHorario}>
        <fieldset className="horario-editor">
          <legend className="form__label">Horario por día</legend>
          {DIAS_SEMANA.map((dia) => {
            const fila = editor[dia]
            const etiqueta = etiquetaDia(dia)
            return (
              <div className="horario-dia" key={dia}>
                <div className="horario-dia__cab">
                  <span className="horario-dia__nombre">{etiqueta}</span>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      aria-label={`${etiqueta} cerrada`}
                      checked={fila.cerrado}
                      onChange={(event) => cambiarDia(dia, { cerrado: event.target.checked })}
                    />
                    Cerrado
                  </label>
                </div>
                <div className="horario-dia__horas">
                  <label className="visually-hidden" htmlFor={`apertura-${sede.id}-${dia}`}>
                    Apertura del {etiqueta.toLowerCase()}
                  </label>
                  <select
                    className="form__input"
                    id={`apertura-${sede.id}-${dia}`}
                    value={fila.apertura}
                    disabled={fila.cerrado}
                    onChange={(event) => cambiarDia(dia, { apertura: Number(event.target.value) })}
                  >
                    {MINUTOS_HORA.map((minutos) => (
                      <option key={minutos} value={minutos}>
                        {etiquetaMinutos(minutos)}
                      </option>
                    ))}
                  </select>
                  <span aria-hidden="true">–</span>
                  <label className="visually-hidden" htmlFor={`cierre-${sede.id}-${dia}`}>
                    Cierre del {etiqueta.toLowerCase()}
                  </label>
                  <select
                    className="form__input"
                    id={`cierre-${sede.id}-${dia}`}
                    value={fila.cierre}
                    disabled={fila.cerrado}
                    onChange={(event) => cambiarDia(dia, { cierre: Number(event.target.value) })}
                  >
                    {MINUTOS_HORA.map((minutos) => (
                      <option key={minutos} value={minutos}>
                        {etiquetaMinutos(minutos)}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="btn btn--secondary horario-dia__aplicar"
                  type="button"
                  aria-label={`Aplicar el horario del ${etiqueta.toLowerCase()} a todos los días`}
                  onClick={() => aplicarATodos(dia)}
                >
                  Aplicar a todos los días
                </button>
              </div>
            )
          })}
        </fieldset>

        {problemaHorario ? (
          <p className="alert alert--error" role="alert">
            {problemaHorario}
          </p>
        ) : null}

        <button className="btn" type="submit" disabled={enviando || Boolean(problemaHorario)}>
          Guardar horario
        </button>
      </form>

      <h3 className="form__label">Canchas</h3>

      {canchas.length === 0 ? <p className="aviso">Esta sede todavía no tiene canchas.</p> : null}

      <ul className="fichas__lista">
        {canchas.map((cancha) => (
          <li key={cancha.id} className="representante-box">
            <div className="fichas__barra">
              <input
                className="form__input"
                aria-label={`Nombre de la cancha ${nombreDeCancha(cancha, cancha.id)}`}
                value={renombres[cancha.id] ?? nombreDeCancha(cancha, cancha.id)}
                onChange={(event) =>
                  setRenombres((prev) => ({ ...prev, [cancha.id]: event.target.value }))
                }
              />
              <button
                className="btn btn--secondary"
                type="button"
                disabled={enviando}
                onClick={() => guardarNombreCancha(cancha)}
              >
                Guardar nombre
              </button>
            </div>
            <div className="fichas__barra">
              <span className="fichas__contador">
                {cancha.activa === false ? 'Inactiva · no admite reservas nuevas' : 'Activa'}
              </span>
              <button
                className="btn btn--secondary"
                type="button"
                disabled={enviando}
                onClick={() => alternarCancha(cancha)}
              >
                {cancha.activa === false ? 'Activar' : 'Desactivar'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form className="fichas__barra" onSubmit={agregarCancha}>
        <input
          className="form__input"
          aria-label="Nombre de la cancha nueva"
          placeholder="Nombre de la cancha nueva"
          value={nuevoNombre}
          onChange={(event) => setNuevoNombre(event.target.value)}
        />
        <button className="btn-cta" type="submit" disabled={enviando}>
          Agregar cancha
        </button>
      </form>
    </section>
  )
}

/*
 * Pantalla de Configuración: "Sedes y canchas". Lee TODAS las sedes del tenant
 * (incluidas las inactivas, para poder reactivarlas) y, para cada una, sus
 * canchas (también las inactivas). Todas las lecturas están acotadas por
 * tenant + sede.
 */
export default function Configuracion() {
  const { academia } = useParams()
  const { user } = useAuth()
  const { mostrarErrorTecnico, mostrarExito } = useAvisos()
  // `null` = todavía no cargó.
  const [sedes, setSedes] = useState(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [nombreNueva, setNombreNueva] = useState('')
  const [creando, setCreando] = useState(false)

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

  const recargar = () => setVersion((valor) => valor + 1)
  const lista = sedes ?? []

  async function agregarSede(event) {
    event.preventDefault()
    setCreando(true)
    try {
      await crearSede(db, academia, { nombre: nombreNueva }, { uid: user?.uid ?? null })
      mostrarExito(`Sede agregada: ${normalizarNombreCancha(nombreNueva)}`)
      setNombreNueva('')
      recargar()
    } catch (err) {
      mostrarErrorTecnico('crear-sede', err)
    } finally {
      setCreando(false)
    }
  }

  return (
    <PageChrome titulo="Configuración">
      <div className="fichas">
        <h2 className="form__label">Sedes y canchas</h2>

        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        <form className="fichas__barra" onSubmit={agregarSede}>
          <input
            className="form__input"
            aria-label="Nombre de la sede nueva"
            placeholder="Nombre de la sede nueva"
            value={nombreNueva}
            onChange={(event) => setNombreNueva(event.target.value)}
          />
          <button className="btn-cta" type="submit" disabled={creando}>
            Agregar sede
          </button>
        </form>

        {sedes === null ? <p className="aviso glass">Cargando sedes…</p> : null}
        {sedes !== null && lista.length === 0 ? (
          <p className="aviso glass">Esta academia todavía no tiene sedes.</p>
        ) : null}

        {lista.map((sede) => (
          // La clave incluye la versión de la recarga: tras cualquier escritura
          // las tarjetas se remontan y el editor vuelve a lo que quedó guardado.
          <SedeCard
            key={`${sede.id}-${version}`}
            tenantId={academia}
            sede={sede}
            canchas={sede.canchas}
            onChanged={recargar}
          />
        ))}
      </div>
    </PageChrome>
  )
}
