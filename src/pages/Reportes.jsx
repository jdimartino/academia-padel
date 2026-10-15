import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import PageChrome from '../components/PageChrome'
import ReportView from '../components/ReportView'
import TasasPanel from '../components/TasasPanel'
import { useTasas } from '../context/TasasContext'
import { db } from '../firebase/config'
import {
  getProfesores,
  listarAlumnosReporte,
  listarCanchas,
  listarCargosDeAlumno,
  listarCargosPorRango,
  listarClasesPorRango,
  listarCreditos,
  listarPagosProfesorPorRango,
  listarPlanes,
  listarSedes,
} from '../firebase/db'
import { formatearFechaLarga } from '../lib/fechas'
import { INFORMES, informePorId, rangoMesActual, textoImporte, textoResumen } from '../lib/reportes'

const ACADEMIA = 'Academia Pádel'

const GRUPOS = [
  { id: 'prioritario', label: 'Informes prioritarios' },
  { id: 'secundario', label: 'Informes complementarios' },
]

const ESTADOS_PERSONA = [
  { valor: 'activos', label: 'Activos' },
  { valor: 'inactivos', label: 'Inactivos' },
  { valor: 'todos', label: 'Todos' },
]

/** ¿El informe usa este filtro? */
const usa = (informe, filtro) => (informe.filtros ?? []).includes(filtro)

/**
 * Reportes (Parte B): pantalla ADMIN-ONLY con los 15 informes. Reusa el mismo
 * marco (PageChrome) y la franja de tasa BCV. Los datos se cargan acotados por
 * rango desde db.js; la agregación es pura (src/lib/reportes.js) y la vista
 * (ReportView) es la misma para todos, con su barra de exportación.
 */
export default function Reportes() {
  const { academia } = useParams()
  const { tasas, fuente } = useTasas()
  const rangoInicial = useMemo(() => rangoMesActual(), [])

  const [informeId, setInformeId] = useState(INFORMES[0].id)
  const [desde, setDesde] = useState(rangoInicial.desde)
  const [hasta, setHasta] = useState(rangoInicial.hasta)
  const [sedeId, setSedeId] = useState('')
  const [profesorId, setProfesorId] = useState('')
  const [alumnoId, setAlumnoId] = useState('')
  const [estado, setEstado] = useState('activos')
  const [dias, setDias] = useState(30)

  const [refs, setRefs] = useState({
    sedes: [],
    canchasPorSede: {},
    profesores: [],
    alumnos: [],
  })
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  const informe = informePorId(informeId) ?? INFORMES[0]

  // Referencias (sedes + canchas, profesores y alumnos) se cargan una sola vez.
  useEffect(() => {
    let activo = true
    Promise.all([
      listarSedes(db, academia),
      getProfesores(db, academia, { estado: 'todos' }),
      listarAlumnosReporte(db, academia, { limite: 300 }),
    ])
      .then(async ([sedes, profesores, alumnos]) => {
        const pares = await Promise.all(
          sedes.map(async (sede) => [sede.id, await listarCanchas(db, academia, sede.id)]),
        )
        if (activo) {
          setRefs({ sedes, canchasPorSede: Object.fromEntries(pares), profesores, alumnos })
        }
      })
      .catch(() => {
        if (activo) setRefs({ sedes: [], canchasPorSede: {}, profesores: [], alumnos: [] })
      })
    return () => {
      activo = false
    }
  }, [academia])

  const cargar = useCallback(async () => {
    const filtros = {
      desde,
      hasta,
      sedeId: sedeId || null,
      profesorId: profesorId || null,
      alumnoId: alumnoId || null,
      estado,
      dias,
    }
    try {
      const fuentes = {}
      const need = new Set(informe.fuentes ?? [])
      if (need.has('clases')) {
        fuentes.clases = await listarClasesPorRango(db, academia, {
          sedeId: filtros.sedeId,
          profesorId: filtros.profesorId,
          desde,
          hasta,
        })
      }
      if (need.has('cargos')) {
        fuentes.cargos = informe.unAlumno
          ? alumnoId
            ? await listarCargosDeAlumno(db, academia, alumnoId, { limite: 200 })
            : []
          : await listarCargosPorRango(db, academia, { sedeId: filtros.sedeId, desde, hasta, estado: 'todos' })
      }
      if (need.has('pagos')) {
        fuentes.pagos = await listarPagosProfesorPorRango(db, academia, {
          sedeId: filtros.sedeId,
          desde,
          hasta,
          estado: 'todos',
        })
      }
      if (need.has('alumnos')) fuentes.alumnos = refs.alumnos
      if (need.has('profesores')) fuentes.profesores = refs.profesores
      if (need.has('sedes')) fuentes.sedes = refs.sedes
      if (need.has('canchas')) fuentes.canchasPorSede = refs.canchasPorSede
      if (need.has('planes')) fuentes.planes = await listarPlanes(db, academia, {})
      if (need.has('creditos')) fuentes.creditos = await listarCreditos(db, academia, {})
      if (informe.unAlumno) {
        fuentes.alumno = refs.alumnos.find((a) => a.id === alumnoId) ?? null
      }
      const salida = informe.construir({ ...fuentes, filtros })
      setResultado(salida)
      setError('')
    } catch (err) {
      setError(err.message)
      setResultado(null)
    }
  }, [academia, informe, desde, hasta, sedeId, profesorId, alumnoId, estado, dias, refs])

  // `aplicar` es el disparador desde la UI (barras de filtros): enciende/apaga el
  // estado de carga. El efecto solo llama a `cargar` para no encender estado de
  // forma síncrona dentro del efecto.
  const aplicar = useCallback(async () => {
    setCargando(true)
    try {
      await cargar()
    } finally {
      setCargando(false)
    }
  }, [cargar])

  useEffect(() => {
    // Carga inicial: los setState ocurren después del await (no en el cuerpo del
    // efecto), pero la regla no lo distingue. Mismo patrón que Cobros.
    // oxlint-disable-next-line react/set-state-in-effect
    cargar()
  }, [cargar])

  const filtrosTexto = useMemo(() => {
    const partes = []
    if (usa(informe, 'rango')) partes.push(`${formatearFechaLarga(desde)} — ${formatearFechaLarga(hasta)}`)
    if (sedeId) partes.push(refs.sedes.find((s) => s.id === sedeId)?.nombre ?? sedeId)
    if (profesorId) {
      const p = refs.profesores.find((x) => x.id === profesorId)
      partes.push(p ? `${p.nombre} ${p.apellidos}` : profesorId)
    }
    if (alumnoId) {
      const a = refs.alumnos.find((x) => x.id === alumnoId)
      partes.push(a ? `${a.nombre} ${a.apellidos}` : alumnoId)
    }
    return partes.join(' · ')
  }, [informe, desde, hasta, sedeId, profesorId, alumnoId, refs])

  const textoCompartir = useMemo(() => {
    if (!resultado) return ''
    const lineas = []
    for (const item of resultado.resumen ?? []) {
      lineas.push(`${item.label}: ${item.tipo === 'money' ? textoImporte(item.valor) : item.valor}`)
    }
    if (!lineas.length && resultado.totales?.valor != null) {
      const t = resultado.totales
      lineas.push(`${t.label ?? 'Total'}: ${t.tipo === 'money' ? textoImporte(t.valor) : t.valor}`)
    }
    if (!lineas.length) lineas.push(`${resultado.filas?.length ?? 0} registro(s)`)
    return textoResumen({ titulo: informe.titulo, rango: filtrosTexto, lineas, academia: ACADEMIA })
  }, [resultado, informe, filtrosTexto])

  const telefono = useMemo(() => {
    if (!informe.unAlumno) return null
    const alumno = refs.alumnos.find((a) => a.id === alumnoId)
    return alumno?.representante?.telefono || alumno?.telefono || null
  }, [informe, refs.alumnos, alumnoId])

  return (
    <PageChrome titulo="Reportes">
      <TasasPanel />

      <div className="reportes">
        <aside className="reportes__lista glass">
          {GRUPOS.map((grupo) => (
            <div key={grupo.id} className="reportes__grupo">
              <h3 className="reportes__grupo-titulo">{grupo.label}</h3>
              <ul className="reportes__items">
                {INFORMES.filter((inf) => inf.grupo === grupo.id).map((inf) => (
                  <li key={inf.id}>
                    <button
                      type="button"
                      className={`reportes__item${inf.id === informeId ? ' is-sel' : ''}`}
                      aria-pressed={inf.id === informeId}
                      onClick={() => setInformeId(inf.id)}
                    >
                      {inf.titulo}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <div className="reportes__contenido">
          <div className="reportes__filtros glass">
            {usa(informe, 'rango') ? (
              <>
                <label className="cobros__campo">
                  <span className="cobros__campo-label">Desde</span>
                  <input className="form__input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
                </label>
                <label className="cobros__campo">
                  <span className="cobros__campo-label">Hasta</span>
                  <input className="form__input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
                </label>
              </>
            ) : null}
            {usa(informe, 'sede') ? (
              <label className="cobros__campo">
                <span className="cobros__campo-label">Sede</span>
                <select className="form__input" value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
                  <option value="">Todas</option>
                  {refs.sedes.map((sede) => (
                    <option key={sede.id} value={sede.id}>
                      {sede.nombre}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {usa(informe, 'profesor') ? (
              <label className="cobros__campo">
                <span className="cobros__campo-label">Profesor</span>
                <select className="form__input" value={profesorId} onChange={(e) => setProfesorId(e.target.value)}>
                  <option value="">Todos</option>
                  {refs.profesores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} {p.apellidos}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {usa(informe, 'alumno') ? (
              <label className="cobros__campo">
                <span className="cobros__campo-label">Alumno</span>
                <select className="form__input" value={alumnoId} onChange={(e) => setAlumnoId(e.target.value)}>
                  <option value="">Elegir…</option>
                  {refs.alumnos.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre} {a.apellidos}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {usa(informe, 'estado') ? (
              <label className="cobros__campo">
                <span className="cobros__campo-label">Estado</span>
                <select className="form__input" value={estado} onChange={(e) => setEstado(e.target.value)}>
                  {ESTADOS_PERSONA.map((op) => (
                    <option key={op.valor} value={op.valor}>
                      {op.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {usa(informe, 'dias') ? (
              <label className="cobros__campo">
                <span className="cobros__campo-label">Días sin clase</span>
                <input
                  className="form__input"
                  type="number"
                  min="1"
                  value={dias}
                  onChange={(e) => setDias(Number(e.target.value) || 30)}
                />
              </label>
            ) : null}
            <button type="button" className="btn-cta" onClick={aplicar} disabled={cargando}>
              {cargando ? 'Cargando…' : 'Aplicar'}
            </button>
          </div>

          {informe.unAlumno && !alumnoId ? (
            <p className="parametros__hint">Elegí un alumno para ver su estado de cuenta.</p>
          ) : null}

          {error ? (
            <p className="form__error" role="alert">
              No se pudo generar el informe: {error}
            </p>
          ) : null}

          {resultado ? (
            <ReportView
              academia={ACADEMIA}
              titulo={informe.titulo}
              filtrosTexto={filtrosTexto}
              columnas={resultado.columnas}
              filas={resultado.filas}
              totales={resultado.totales}
              resumen={resultado.resumen}
              tasas={tasas}
              fuente={fuente}
              textoCompartir={textoCompartir}
              telefono={telefono}
              nombreArchivo={informe.id}
              onRefrescar={aplicar}
            />
          ) : null}
        </div>
      </div>
    </PageChrome>
  )
}
