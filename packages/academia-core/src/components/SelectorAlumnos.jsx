import { useEffect, useMemo, useState } from 'react'
import { db } from '../firebase/config'
import { buscarAlumnos, nombreCompleto } from '../firebase/db'
import { aMinutos, formatHora12 } from '../lib/agenda'

/** ¿Dos rangos "HH:mm" se solapan? Puro. */
function solapanRango(ahoraInicio, ahoraFin, otraInicio, otraFin) {
  const ai = aMinutos(ahoraInicio)
  const af = aMinutos(ahoraFin)
  const bi = aMinutos(otraInicio)
  const bf = aMinutos(otraFin)
  return ai !== null && af !== null && bi !== null && bf !== null && bi < af && ai < bf
}

/*
 * Selector de alumnos con búsqueda-as-you-type (buscarAlumnos, activos, limit
 * 10) y chips removibles, acotado por el cupo. El aviso de "ya tiene clase a
 * esa hora" es SOLO del lado del cliente y no bloquea: la transacción de db.js
 * sigue siendo la fuente de verdad para cancha y profesor (y valida cupo,
 * existencia y activo).
 */
export default function SelectorAlumnos({
  tenantId,
  cupo,
  seleccionados,
  onChange,
  clases = [],
  claseId = null,
  horaInicio,
  horaFin,
}) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const q = texto.trim()
    let activo = true
    const timer = setTimeout(() => {
      if (!activo) return
      if (q.length < 2) {
        setResultados([])
        setBuscando(false)
        setError('')
        return
      }
      setBuscando(true)
      buscarAlumnos(db, tenantId, q, { limite: 10 })
        .then((lista) => {
          if (activo) {
            setResultados(lista)
            setError('')
          }
        })
        .catch((err) => {
          if (activo) setError(err.message)
        })
        .finally(() => {
          if (activo) setBuscando(false)
        })
    }, 300)
    return () => {
      activo = false
      clearTimeout(timer)
    }
  }, [texto, tenantId])

  const ids = useMemo(() => new Set(seleccionados.map((a) => a.id)), [seleccionados])
  const lleno = seleccionados.length >= cupo

  const avisos = useMemo(() => {
    const lista = []
    for (const alumno of seleccionados) {
      const choque = (clases ?? []).find(
        (clase) =>
          clase.id !== claseId &&
          clase.estado !== 'cancelada' &&
          (clase.alumnos ?? []).includes(alumno.id) &&
          solapanRango(horaInicio, horaFin, clase.horaInicio, clase.horaFin),
      )
      if (choque) {
        lista.push(
          `${alumno.nombre} ya tiene una clase de ${formatHora12(choque.horaInicio)} a ${formatHora12(choque.horaFin)}.`,
        )
      }
    }
    return lista
  }, [seleccionados, clases, claseId, horaInicio, horaFin])

  function agregar(alumno) {
    if (ids.has(alumno.id) || lleno) return
    onChange([...seleccionados, { id: alumno.id, nombre: nombreCompleto(alumno) }])
    setTexto('')
    setResultados([])
  }

  function quitar(id) {
    onChange(seleccionados.filter((alumno) => alumno.id !== id))
  }

  const visibles = resultados.filter((alumno) => !ids.has(alumno.id))

  return (
    <div className="form__field">
      <span className="form__label">
        Alumnos ({seleccionados.length} de {cupo})
      </span>

      {seleccionados.length ? (
        <ul className="chips-sel">
          {seleccionados.map((alumno) => (
            <li key={alumno.id}>
              <button
                type="button"
                className="chip-rem"
                aria-label={`Quitar a ${alumno.nombre}`}
                onClick={() => quitar(alumno.id)}
              >
                {alumno.nombre} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {lleno ? (
        <p className="aviso">Cupo completo ({cupo}).</p>
      ) : (
        <>
          <input
            className="form__input"
            type="search"
            value={texto}
            placeholder="Buscar por nombre o apellido..."
            onChange={(event) => setTexto(event.target.value)}
          />
          {buscando ? <p className="aviso">Buscando…</p> : null}
          {error ? (
            <p className="alert alert--error" role="alert">
              {error}
            </p>
          ) : null}
          {texto.trim().length > 0 && texto.trim().length < 2 ? (
            <p className="aviso">Escribe al menos 2 letras para buscar.</p>
          ) : null}
          {texto.trim().length >= 2 && !buscando && visibles.length === 0 ? (
            <p className="aviso">Sin resultados.</p>
          ) : null}
          {visibles.length ? (
            <ul className="sugerencias">
              {visibles.map((alumno) => (
                <li key={alumno.id}>
                  <button type="button" className="sugerencia" onClick={() => agregar(alumno)}>
                    <span>{nombreCompleto(alumno)}</span>
                    <span className="sugerencia__meta">
                      {alumno.tipo === 'menor' ? 'Menor' : 'Adulto'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      {avisos.map((aviso) => (
        <p key={aviso} className="aviso aviso--warn" role="status">
          {aviso}
        </p>
      ))}
    </div>
  )
}
