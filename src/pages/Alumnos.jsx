import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import FichaAlumnoSheet from '../components/FichaAlumnoSheet'
import PageChrome from '../components/PageChrome'
import TablaPersonas from '../components/TablaPersonas'
import { db } from '../firebase/config'
import { buscarAlumnos, listarAlumnos, nombreCompleto } from '../firebase/db'
import { etiquetaCategoria } from '../lib/agenda'

const ESTADOS = [
  { valor: 'activos', label: 'Activos' },
  { valor: 'inactivos', label: 'Inactivos' },
  { valor: 'todos', label: 'Todos' },
]

/** Resultados de la búsqueda de la pantalla (el selector de la reserva usa 10). */
const LIMITE_BUSQUEDA = 30

/** Tamaño de página del listado (el tope duro también es 100 en db.js). */
const LIMITE_PAGINA = 100

/*
 * Pantalla de Alumnos: al abrir carga la primera página (100) ordenada por
 * apellido, sin necesidad de buscar. El filtro de estado cambia la consulta y
 * "Cargar más" pide la página siguiente con el cursor. La búsqueda (>= 2 letras,
 * debounce 300 ms) reemplaza el listado por hasta 30 resultados; al limpiarla se
 * vuelve al listado ya cargado, sin releer. La tabla es la misma que Profesores
 * (`TablaPersonas`).
 */
export default function Alumnos() {
  const { academia } = useParams()
  const [estado, setEstado] = useState('activos')
  const [texto, setTexto] = useState('')
  // `null` = primera página todavía en vuelo; `[]` = ya cargó y no hay nada.
  const [alumnos, setAlumnos] = useState(null)
  const [siguiente, setSiguiente] = useState(null)
  // `null` = sin búsqueda activa (o búsqueda en vuelo).
  const [resultados, setResultados] = useState(null)
  const [hayMasResultados, setHayMasResultados] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(null)
  // Se incrementa para releer después de crear, editar, desactivar o reactivar.
  const [recarga, setRecarga] = useState(0)

  const query = texto.trim()
  const buscandoActivo = query.length >= 2
  const lista = alumnos ?? []
  const cargandoLista = alumnos === null
  const buscando = buscandoActivo && resultados === null

  // Primera página. A propósito NO depende de `texto`: escribir o borrar la
  // búsqueda no vuelve a leer el listado.
  useEffect(() => {
    let activo = true
    listarAlumnos(db, academia, { estado, limite: LIMITE_PAGINA })
      .then((pagina) => {
        if (!activo) return
        setAlumnos(pagina.alumnos)
        setSiguiente(pagina.siguiente)
        setError('')
      })
      .catch(() => {
        if (!activo) return
        setAlumnos([])
        setSiguiente(null)
        setError('No se pudieron cargar los alumnos. Intenta de nuevo.')
      })
    return () => {
      activo = false
    }
  }, [academia, estado, recarga])

  // Búsqueda debounced. Con 0 o 1 letra el efecto no hace nada: el listado ya
  // está y `texto` sigue siendo el mismo, así que no se relee.
  useEffect(() => {
    if (!buscandoActivo) return undefined
    let activo = true
    const timer = setTimeout(() => {
      buscarAlumnos(db, academia, query, { estado, limite: LIMITE_BUSQUEDA })
        .then((encontrados) => {
          if (!activo) return
          setResultados(encontrados)
          setHayMasResultados(encontrados.length >= LIMITE_BUSQUEDA)
          setError('')
        })
        .catch(() => {
          if (!activo) return
          setResultados([])
          setHayMasResultados(false)
          setError('No se pudo buscar. Intenta de nuevo.')
        })
    }, 300)
    return () => {
      activo = false
      clearTimeout(timer)
    }
  }, [academia, estado, query, buscandoActivo, recarga])

  /** Cambia el filtro: reinicia el listado y la búsqueda. */
  function cambiarEstado(nuevo) {
    setEstado(nuevo)
    setTexto('')
    setResultados(null)
    setHayMasResultados(false)
    setAlumnos(null)
    setSiguiente(null)
    setError('')
  }

  /** Suma la página siguiente sin repetir filas. */
  async function cargarMas() {
    if (!siguiente || cargandoMas) return
    setCargandoMas(true)
    try {
      const pagina = await listarAlumnos(db, academia, {
        estado,
        limite: LIMITE_PAGINA,
        despues: siguiente,
      })
      setAlumnos((previos) => {
        const vistos = new Set((previos ?? []).map((a) => a.id))
        return [...(previos ?? []), ...pagina.alumnos.filter((a) => !vistos.has(a.id))]
      })
      setSiguiente(pagina.siguiente)
      setError('')
    } catch {
      setError('No se pudieron cargar más alumnos. Intenta de nuevo.')
    } finally {
      setCargandoMas(false)
    }
  }

  /** Tras guardar la ficha: relee la página (o la búsqueda) del filtro actual. */
  function recargarAlumnos() {
    setEditando(null)
    setRecarga((valor) => valor + 1)
  }

  const filas = buscandoActivo ? (resultados ?? []) : lista
  const cargando = buscandoActivo ? buscando : cargandoLista
  const mensajeVacio = 'Aún no hay alumnos. Crea el primero con Nuevo alumno.'

  const columnas = [
    {
      id: 'nombre',
      label: 'Nombre',
      render: (alumno) => (
        <span className="celda-nombre">
          {nombreCompleto(alumno)}
          {alumno.activo === false ? <span className="ficha-item__marca">Inactivo</span> : null}
        </span>
      ),
    },
    { id: 'contacto', label: 'Contacto', render: (alumno) => contactoDeAlumno(alumno) },
    { id: 'nivel', label: 'Nivel', render: (alumno) => metaDeAlumno(alumno) },
    {
      id: 'acciones',
      label: 'Acciones',
      className: 'tabla-comp__acciones',
      render: (alumno) => (
        <button
          type="button"
          className="btn-icono"
          onClick={(evento) => {
            evento.stopPropagation()
            setEditando({ alumno })
          }}
        >
          Ver
        </button>
      ),
    },
  ]

  const contador = buscandoActivo
    ? null
    : cargandoLista
      ? 'Cargando…'
      : `${lista.length}${siguiente ? '+' : ''} ${
          estado === 'inactivos' ? 'inactivos' : estado === 'todos' ? 'en total' : 'activos'
        }`

  return (
    <PageChrome titulo="Alumnos">
      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}

      {hayMasResultados ? (
        <p className="aviso glass">Hay más resultados: escribe más letras para acotar.</p>
      ) : null}

      <TablaPersonas
        columnas={columnas}
        filas={filas}
        onFila={(alumno) => setEditando({ alumno })}
        cargando={cargando}
        vacio={mensajeVacio}
        textoBusqueda={texto}
        onBuscar={(valor) => {
          setTexto(valor)
          setResultados(null)
          setHayMasResultados(false)
        }}
        placeholderBusqueda="Buscar por nombre o apellido"
        sinResultados="No hay alumnos que coincidan con la búsqueda."
        estados={ESTADOS}
        estadoValor={estado}
        onEstado={cambiarEstado}
        onNuevo={() => setEditando({})}
        etiquetaNuevo="Nuevo alumno"
        contador={contador}
        cargandoMas={cargandoMas}
        hayMas={!buscandoActivo && Boolean(siguiente)}
        onCargarMas={cargarMas}
      />

      {editando ? (
        <FichaAlumnoSheet
          key={editando.alumno?.id ?? 'nuevo'}
          tenantId={academia}
          alumno={editando.alumno ?? null}
          onClose={() => setEditando(null)}
          onSaved={recargarAlumnos}
        />
      ) : null}
    </PageChrome>
  )
}

/** Meta de la fila: Adulto/Menor y nivel. */
function metaDeAlumno(alumno) {
  const partes = [alumno.tipo === 'menor' ? 'Menor' : 'Adulto']
  if (alumno.nivel) partes.push(etiquetaCategoria(alumno.nivel))
  return partes.join(' · ')
}

/** Contacto de la fila: para un menor sin teléfono, el del representante. */
function contactoDeAlumno(alumno) {
  if (alumno.telefono) return alumno.telefono
  const representante = alumno.representante
  if (!representante?.nombre) return 'Sin teléfono'
  const nombre = [representante.nombre, representante.apellidos].filter(Boolean).join(' ')
  return representante.telefono ? `${nombre} · ${representante.telefono}` : nombre
}
