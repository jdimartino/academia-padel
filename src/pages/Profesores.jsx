import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import FichaProfesorSheet from '../components/FichaProfesorSheet'
import PageChrome from '../components/PageChrome'
import { db } from '../firebase/config'
import { getProfesores } from '../firebase/db'

/*
 * Lista de profesores activos (getProfesores, acotado con limit 50) con alta y
 * edición en el sheet. Sin buscador: el catálogo de profesores es chico.
 */
export default function Profesores() {
  const { academia } = useParams()
  const [profesores, setProfesores] = useState(null)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let activo = true
    getProfesores(db, academia)
      .then((lista) => {
        if (!activo) return
        setProfesores(lista)
        setError('')
      })
      .catch((err) => {
        if (activo) setError(err.message)
      })
    return () => {
      activo = false
    }
  }, [academia, version])

  return (
    <PageChrome titulo="Profesores">
      <div className="fichas">
        <div className="fichas__barra">
          <span className="fichas__contador">
            {profesores === null ? 'Cargando…' : `${profesores.length} activos`}
          </span>
          <button type="button" className="btn-cta" onClick={() => setEditando({})}>
            Nuevo profesor
          </button>
        </div>

        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        {profesores === null ? <p className="aviso glass">Cargando profesores…</p> : null}
        {profesores !== null && profesores.length === 0 ? (
          <p className="aviso glass">Todavía no hay profesores activos.</p>
        ) : null}

        {profesores?.length ? (
          <ul className="fichas__lista">
            {profesores.map((profesor) => (
              <li key={profesor.id}>
                <button
                  type="button"
                  className="ficha-item glass"
                  onClick={() => setEditando({ profesor })}
                >
                  <span className="ficha-item__nombre">{profesor.nombre}</span>
                  <span className="ficha-item__meta">{profesor.telefono ?? 'Sin teléfono'}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {editando ? (
        <FichaProfesorSheet
          key={editando.profesor?.id ?? 'nuevo'}
          tenantId={academia}
          profesor={editando.profesor ?? null}
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
