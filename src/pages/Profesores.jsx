import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import FichaProfesorSheet from '../components/FichaProfesorSheet'
import PageChrome from '../components/PageChrome'
import TablaPersonas from '../components/TablaPersonas'
import { db } from '../firebase/config'
import { LIMITE_PROFESORES, getProfesores, listarSedes, nombreCompleto } from '../firebase/db'

const ESTADOS = [
  { valor: 'activos', label: 'Activos' },
  { valor: 'inactivos', label: 'Inactivos' },
  { valor: 'todos', label: 'Todos' },
]

/*
 * Pantalla de Profesores: lista completa del tenant (limit 200) ordenada por
 * apellidos y después nombre, con filtro de estado y buscador client-side (el
 * conjunto ya está acotado). Usa la misma tabla compacta que Alumnos
 * (`TablaPersonas`). El alta y la edición (incluida la reactivación) van en el
 * sheet.
 */
export default function Profesores() {
  const { academia } = useParams()
  const [estado, setEstado] = useState('activos')
  const [texto, setTexto] = useState('')
  // `null` = todavía no cargó.
  const [profesores, setProfesores] = useState(null)
  const [sedes, setSedes] = useState([])
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

  // Nombres de sedes para mostrar las asignaciones del profesor.
  useEffect(() => {
    let activo = true
    listarSedes(db, academia)
      .then((lista) => {
        if (activo) setSedes(lista)
      })
      .catch(() => {
        if (activo) setSedes([])
      })
    return () => {
      activo = false
    }
  }, [academia])

  const lista = profesores ?? []
  const cargando = profesores === null

  const nombreSede = useMemo(
    () => Object.fromEntries(sedes.map((sede) => [sede.id, sede.nombre])),
    [sedes],
  )

  // Filtro client-side por nombre/apellidos (el listado ya está acotado a 200).
  const query = texto.trim().toLowerCase()
  const filas = query
    ? lista.filter((profesor) =>
        nombreCompleto(profesor).toLowerCase().includes(query),
      )
    : lista

  const mensajeVacio =
    estado === 'inactivos'
      ? 'No hay profesores inactivos.'
      : 'Todavía no hay profesores activos. Crea el primero con Nuevo profesor.'

  const columnas = [
    {
      id: 'nombre',
      label: 'Nombre',
      render: (profesor) => (
        <span className="celda-nombre">
          {nombreCompleto(profesor)}
          {profesor.activo === false ? <span className="ficha-item__marca">Inactivo</span> : null}
        </span>
      ),
    },
    {
      id: 'telefono',
      label: 'Teléfono',
      render: (profesor) => profesor.telefono ?? 'Sin teléfono',
    },
    {
      id: 'sedes',
      label: 'Sedes',
      render: (profesor) => {
        const ids = profesor.sedes ?? []
        if (!ids.length) return 'Sin sede'
        return ids.map((id) => nombreSede[id] ?? 'Sede').join(', ')
      },
    },
    {
      id: 'acciones',
      label: 'Acciones',
      className: 'tabla-comp__acciones',
      render: (profesor) => (
        <button
          type="button"
          className="btn-icono"
          onClick={(evento) => {
            evento.stopPropagation()
            setEditando({ profesor })
          }}
        >
          Ver
        </button>
      ),
    },
  ]

  return (
    <PageChrome titulo="Profesores">
      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <TablaPersonas
        columnas={columnas}
        filas={filas}
        onFila={(profesor) => setEditando({ profesor })}
        cargando={cargando}
        vacio={mensajeVacio}
        textoBusqueda={texto}
        onBuscar={setTexto}
        placeholderBusqueda="Buscar por nombre o apellido"
        sinResultados="No hay profesores que coincidan con la búsqueda."
        estados={ESTADOS}
        estadoValor={estado}
        onEstado={(nuevo) => {
          setEstado(nuevo)
          setTexto('')
          setProfesores(null)
          setError('')
        }}
        onNuevo={() => setEditando({})}
        etiquetaNuevo="Nuevo profesor"
        contador={
          cargando
            ? 'Cargando…'
            : `${filas.length} ${estado === 'inactivos' ? 'inactivos' : estado === 'todos' ? 'en total' : 'activos'}`
        }
      />

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
