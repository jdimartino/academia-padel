import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import PageChrome from '../components/PageChrome'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import {
  cambiarActivaCancha,
  crearCancha,
  getSedes,
  horarioDeSede,
  listarCanchas,
  nombreDeCancha,
  renombrarCancha,
  setSedeHorario,
} from '../firebase/db'
import { formatHora12 } from '../lib/agenda'

/** Horas enteras 0-24 para los selectores de apertura y cierre. */
const HORAS = Array.from({ length: 25 }, (_, hora) => hora)

/**
 * Etiqueta visible del selector (los valores guardados siguen siendo enteros
 * 0-24): 12 horas con AM/PM. La hora 24 se aclara como medianoche.
 */
const etiquetaHora = (hora) =>
  hora === 24 ? `${formatHora12(hora)} (medianoche)` : formatHora12(hora)

/*
 * Configuración de una sede: su horario (apertura y cierre en horas enteras) y
 * sus canchas (agregar, renombrar y activar/desactivar; nunca se borran). Los
 * errores van en rojo arriba del formulario, igual que en la reserva.
 */
function SedeCard({ tenantId, sede, canchas, onChanged }) {
  const { user } = useAuth()
  const uid = user?.uid ?? null
  const horario = horarioDeSede(sede)
  const [apertura, setApertura] = useState(horario.apertura)
  const [cierre, setCierre] = useState(horario.cierre)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [renombres, setRenombres] = useState({})
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  /** Corre una escritura de la sede y recarga; devuelve si salió bien. */
  async function ejecutar(accion) {
    setError('')
    setEnviando(true)
    try {
      await accion()
      onChanged()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setEnviando(false)
    }
  }

  function guardarHorario(event) {
    event.preventDefault()
    ejecutar(() =>
      setSedeHorario(
        db,
        tenantId,
        sede.id,
        { apertura: Number(apertura), cierre: Number(cierre) },
        { uid },
      ),
    )
  }

  async function agregarCancha(event) {
    event.preventDefault()
    const ok = await ejecutar(() =>
      crearCancha(db, tenantId, sede.id, { nombre: nuevoNombre }, { uid }),
    )
    if (ok) setNuevoNombre('')
  }

  async function guardarNombre(cancha) {
    const valor = renombres[cancha.id] ?? nombreDeCancha(cancha, cancha.id)
    const ok = await ejecutar(() =>
      renombrarCancha(db, tenantId, sede.id, cancha.id, valor, { uid }),
    )
    if (ok) {
      setRenombres((prev) => {
        const siguiente = { ...prev }
        delete siguiente[cancha.id]
        return siguiente
      })
    }
  }

  function alternarCancha(cancha) {
    ejecutar(() =>
      cambiarActivaCancha(db, tenantId, sede.id, cancha.id, cancha.activa === false, { uid }),
    )
  }

  return (
    <section className="representante-box" aria-label={`Sede ${sede.nombre}`}>
      <h2 className="form__label">{sede.nombre}</h2>

      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="fichas__barra" onSubmit={guardarHorario}>
        <div className="form__field">
          <label className="form__label" htmlFor={`horario-apertura-${sede.id}`}>
            Apertura
          </label>
          <select
            className="form__input"
            id={`horario-apertura-${sede.id}`}
            value={apertura}
            onChange={(event) => setApertura(Number(event.target.value))}
          >
            {HORAS.map((hora) => (
              <option key={hora} value={hora}>
                {etiquetaHora(hora)}
              </option>
            ))}
          </select>
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor={`horario-cierre-${sede.id}`}>
            Cierre
          </label>
          <select
            className="form__input"
            id={`horario-cierre-${sede.id}`}
            value={cierre}
            onChange={(event) => setCierre(Number(event.target.value))}
          >
            {HORAS.map((hora) => (
              <option key={hora} value={hora}>
                {etiquetaHora(hora)}
              </option>
            ))}
          </select>
        </div>

        <button className="btn" type="submit" disabled={enviando}>
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
                onClick={() => guardarNombre(cancha)}
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
 * Pantalla de Configuración: "Sedes y canchas". Lee las sedes activas del tenant
 * y, para cada una, sus canchas (incluidas las inactivas). Todas las lecturas
 * están acotadas por tenant + sede.
 */
export default function Configuracion() {
  const { academia } = useParams()
  // `null` = todavía no cargó.
  const [sedes, setSedes] = useState(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let activo = true
    async function cargar() {
      try {
        const lista = await getSedes(db, academia)
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

  return (
    <PageChrome titulo="Configuración">
      <div className="fichas">
        <h2 className="form__label">Sedes y canchas</h2>

        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        {sedes === null ? <p className="aviso glass">Cargando sedes…</p> : null}
        {sedes !== null && lista.length === 0 ? (
          <p className="aviso glass">Esta academia todavía no tiene sedes.</p>
        ) : null}

        {lista.map((sede) => (
          <SedeCard
            key={sede.id}
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
