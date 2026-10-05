import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import FichaAlumnoSheet from '../components/FichaAlumnoSheet'
import PageChrome from '../components/PageChrome'
import { db } from '../firebase/config'
import { buscarAlumnos, nombreCompleto } from '../firebase/db'
import { etiquetaCategoria } from '../lib/agenda'

/*
 * Buscador de alumnos. NO carga la colección completa: cada tecleo (con debounce
 * de 300 ms) consulta `buscarAlumnos` (prefijo de nombre o apellido, activos,
 * mínimo 2 letras, limit 10). El alta/edición va en el sheet.
 */
export default function Alumnos() {
  const { academia } = useParams()
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(null)
  const [version, setVersion] = useState(0)

  const query = texto.trim()

  useEffect(() => {
    let activo = true
    const timer = setTimeout(() => {
      if (!activo) return
      if (query.length < 2) {
        setResultados([])
        setCargando(false)
        setError('')
        return
      }
      setCargando(true)
      buscarAlumnos(db, academia, query, { limite: 10 })
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
          if (activo) setCargando(false)
        })
    }, 300)
    return () => {
      activo = false
      clearTimeout(timer)
    }
  }, [query, academia, version])

  return (
    <PageChrome titulo="Alumnos">
      <div className="fichas">
        <div className="fichas__barra">
          <input
            className="form__input"
            type="search"
            value={texto}
            placeholder="Buscar por nombre o apellido..."
            aria-label="Buscar alumno por nombre o apellido"
            onChange={(event) => setTexto(event.target.value)}
          />
          <button type="button" className="btn-cta" onClick={() => setEditando({})}>
            Nuevo alumno
          </button>
        </div>

        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        {cargando ? <p className="aviso glass">Buscando…</p> : null}
        {!cargando && query.length < 2 ? (
          <p className="aviso glass">Escribe al menos 2 letras para buscar.</p>
        ) : null}
        {!cargando && query.length >= 2 && resultados.length === 0 ? (
          <p className="aviso glass">Sin resultados.</p>
        ) : null}

        {resultados.length ? (
          <ul className="fichas__lista">
            {resultados.map((alumno) => (
              <li key={alumno.id}>
                <button
                  type="button"
                  className="ficha-item glass"
                  onClick={() => setEditando({ alumno })}
                >
                  <span className="ficha-item__nombre">{nombreCompleto(alumno)}</span>
                  <span className="ficha-item__meta">
                    {alumno.tipo === 'menor' ? 'Menor' : 'Adulto'}
                    {alumno.nivel ? ` · ${etiquetaCategoria(alumno.nivel)}` : ''}
                    {alumno.activo === false ? ' · Inactivo' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {editando ? (
        <FichaAlumnoSheet
          key={editando.alumno?.id ?? 'nuevo'}
          tenantId={academia}
          alumno={editando.alumno ?? null}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null)
            setVersion((v) => v + 1)
          }}
        />
      ) : null}
    </PageChrome>
  )
}
