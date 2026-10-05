import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import FichaProfesorSheet from '../components/FichaProfesorSheet'
import PageChrome from '../components/PageChrome'
import { db } from '../firebase/config'
import { LIMITE_PROFESORES, getProfesores, nombreCompleto } from '../firebase/db'

const ESTADOS = [
  { valor: 'activos', label: 'Activos' },
  { valor: 'inactivos', label: 'Inactivos' },
  { valor: 'todos', label: 'Todos' },
]

/*
 * Pantalla de Profesores: lista completa del tenant (limit 200) ordenada por
 * apellidos y después nombre, con filtro de estado y sin buscador. El alta y la
 * edición (incluida la reactivación) van en el sheet.
 */
export default function Profesores() {
  const { academia } = useParams()
  const [estado, setEstado] = useState('activos')
  // `null` = todavía no cargó.
  const [profesores, setProfesores] = useState(null)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(null)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    let activo = true
    getProfesores(db, academia, { estado, limite: LIMITE_PROFESORES })
      .then((lista) => {
        if (!activo) return
        setProfesores(lista)
        setError('')
      })
      .catch(() => {
        if (!activo) return
        setProfesores([])
        setError('No se pudieron cargar los profesores. Intenta de nuevo.')
      })
    return () => {
      activo = false
    }
  }, [academia, estado, recarga])

  const lista = profesores ?? []
  const cargando = profesores === null
  const mensajeVacio =
    estado === 'inactivos'
      ? 'No hay profesores inactivos.'
      : 'Todavia no hay profesores activos. Crea el primero con Nuevo profesor.'

  return (
    <PageChrome titulo="Profesores">
      <div className="fichas">
        <div className="fichas__barra">
          <button type="button" className="btn-cta" onClick={() => setEditando({})}>
            Nuevo profesor
          </button>
        </div>

        <div className="seg" role="group" aria-label="Filtrar profesores por estado">
          {ESTADOS.map((opcion) => (
            <button
              key={opcion.valor}
              type="button"
              className={`seg__op${estado === opcion.valor ? ' is-sel' : ''}`}
              aria-pressed={estado === opcion.valor}
              onClick={() => {
                setEstado(opcion.valor)
                setProfesores(null)
                setError('')
              }}
            >
              {opcion.label}
            </button>
          ))}
        </div>

        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        <span className="fichas__contador">
          {cargando
            ? 'Cargando…'
            : `${lista.length} ${estado === 'inactivos' ? 'inactivos' : estado === 'todos' ? 'en total' : 'activos'}`}
        </span>

        {cargando ? <p className="aviso glass">Cargando profesores…</p> : null}
        {!cargando && lista.length === 0 ? <p className="aviso glass">{mensajeVacio}</p> : null}

        {lista.length > 0 ? (
          <ul className="fichas__lista">
            {lista.map((profesor) => (
              <li key={profesor.id}>
                <button
                  type="button"
                  className="ficha-item glass"
                  onClick={() => setEditando({ profesor })}
                >
                  <span className="ficha-item__nombre">
                    {nombreCompleto(profesor)}
                    {profesor.activo === false ? (
                      <span className="ficha-item__marca">Inactivo</span>
                    ) : null}
                  </span>
                  <span className="ficha-item__meta">{profesor.telefono ?? 'Sin telefono'}</span>
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
            setRecarga((valor) => valor + 1)
          }}
        />
      ) : null}
    </PageChrome>
  )
}
