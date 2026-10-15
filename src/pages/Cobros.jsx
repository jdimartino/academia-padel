import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import BotonAccion from '../components/BotonAccion'
import MontoEquivalente from '../components/MontoEquivalente'
import PageChrome from '../components/PageChrome'
import TasasPanel from '../components/TasasPanel'
import { useAuth } from '../context/AuthContext'
import { useCargando } from '../context/CargandoContext'
import { useTasas } from '../context/TasasContext'
import useAccion from '../hooks/useAccion'
import { db } from '../firebase/config'
import {
  listarCargosPendientes,
  listarPagosProfesorPendientes,
  listarSedes,
  marcarCargoPagado,
  marcarPagoProfesorPagado,
} from '../firebase/db'
import { METODOS_PAGO } from '../lib/cobros'
import { formatearFechaLarga, hoyISO, sumarDias } from '../lib/fechas'

const METODOS_LABEL = {
  efectivo: 'Efectivo',
  zelle: 'Zelle',
  pago_movil: 'Pago móvil',
  transferencia: 'Transferencia',
  otro: 'Otro',
}

const CONCEPTOS_LABEL = {
  clase: 'Clase',
  falta_sin_aviso: 'Falta sin aviso',
  mensualidad: 'Mensualidad',
  otro: 'Otro',
}

const ESTADOS_COBRO = [
  { valor: 'pendiente', label: 'Pendientes' },
  { valor: 'pagado', label: 'Pagados' },
]

/** Selector de método de pago + confirmación, en línea. */
function AccionPagado({ onConfirmar, ocupado, control, accion, exito }) {
  const [abierto, setAbierto] = useState(false)
  const [metodoPago, setMetodoPago] = useState('efectivo')

  if (!abierto) {
    return (
      <button
        type="button"
        className="btn-icono"
        disabled={ocupado}
        onClick={() => setAbierto(true)}
      >
        Marcar pagado
      </button>
    )
  }
  return (
    <div className="cobros__accion">
      <select
        className="form__input"
        value={metodoPago}
        onChange={(e) => setMetodoPago(e.target.value)}
        aria-label="Método de pago"
      >
        {METODOS_PAGO.map((metodo) => (
          <option key={metodo} value={metodo}>
            {METODOS_LABEL[metodo] ?? metodo}
          </option>
        ))}
      </select>
      <BotonAccion
        control={control}
        onClick={() => onConfirmar(metodoPago)}
        accion={accion}
        exito={exito}
        textoOcupado="Marcando…"
        className="btn-icono"
      >
        Confirmar
      </BotonAccion>
      <button type="button" className="btn-icono" disabled={ocupado} onClick={() => setAbierto(false)}>
        Cancelar
      </button>
    </div>
  )
}

/**
 * Cobros (Phase 4, rediseño compacto): cargos de alumnos y pagos al profesor,
 * con una única barra de filtros (sede, estado, rango de fechas) y tablas densas
 * de columnas alineadas con totales por sección. En los pendientes cada fila
 * permite marcar pagado eligiendo el método.
 */
export default function Cobros() {
  const { academia } = useParams()
  const { user } = useAuth()
  const { iniciar: iniciarCarga, terminar: terminarCarga } = useCargando()
  const { tasas } = useTasas()
  const control = useAccion()
  const uid = user?.uid ?? null

  const [sedes, setSedes] = useState([])
  const [sedeId, setSedeId] = useState('')
  const [estado, setEstado] = useState('pendiente')
  const [desde, setDesde] = useState(sumarDias(hoyISO(), -30))
  const [hasta, setHasta] = useState(hoyISO())

  const [cargos, setCargos] = useState(null)
  const [pagos, setPagos] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listarSedes(db, academia)
      .then(setSedes)
      .catch(() => setSedes([]))
  }, [academia])

  const nombreSede = useMemo(
    () => Object.fromEntries(sedes.map((sede) => [sede.id, sede.nombre])),
    [sedes],
  )

  const recargar = useCallback(() => {
    const filtros = { sedeId: sedeId || null, estado, desde, hasta }
    iniciarCarga()
    return Promise.all([
      listarCargosPendientes(db, academia, filtros),
      listarPagosProfesorPendientes(db, academia, filtros),
    ])
      .then(([listaCargos, listaPagos]) => {
        setCargos(listaCargos)
        setPagos(listaPagos)
        setError('')
      })
      .catch((err) => setError(err.message))
      .finally(terminarCarga)
  }, [academia, sedeId, estado, desde, hasta, iniciarCarga, terminarCarga])

  useEffect(() => {
    recargar()
  }, [recargar])

  async function pagarCargo(cargo, metodoPago) {
    await marcarCargoPagado(db, academia, cargo.id, { metodoPago }, { uid })
    await recargar()
  }

  async function pagarProfesor(pago, metodoPago) {
    await marcarPagoProfesorPagado(db, academia, pago.id, { metodoPago }, { uid })
    await recargar()
  }

  const totalCargos = useMemo(
    () => (cargos ?? []).reduce((total, cargo) => total + cargo.montoCents, 0),
    [cargos],
  )
  const totalPagos = useMemo(
    () => (pagos ?? []).reduce((total, pago) => total + pago.montoCents, 0),
    [pagos],
  )

  const cargando = cargos === null && pagos === null
  const esPendiente = estado === 'pendiente'

  return (
    <PageChrome titulo="Cobros">
      <TasasPanel />

      <div className="cobros">
        <div className="cobros__toolbar glass">
          <label className="cobros__campo">
            <span className="cobros__campo-label">Sede</span>
            <select className="form__input" value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
              <option value="">Todas</option>
              {sedes.map((sede) => (
                <option key={sede.id} value={sede.id}>
                  {sede.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="cobros__campo">
            <span className="cobros__campo-label">Estado</span>
            <select className="form__input" value={estado} onChange={(e) => setEstado(e.target.value)}>
              {ESTADOS_COBRO.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.label}
                </option>
              ))}
            </select>
          </label>
          <label className="cobros__campo">
            <span className="cobros__campo-label">Desde</span>
            <input
              className="form__input"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </label>
          <label className="cobros__campo">
            <span className="cobros__campo-label">Hasta</span>
            <input
              className="form__input"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </label>
        </div>

        {error ? (
          <p className="form__error" role="alert">
            No se pudieron cargar los cobros: {error}
          </p>
        ) : null}

        {cargando ? (
          <p className="aviso">Cargando cobros…</p>
        ) : (
          <div className="cobros-pendientes">
            <section className="cobros__bloque glass">
              <header className="cobros__cab">
                <h2 className="cobros__titulo">Cargos de alumnos</h2>
                <span className="cobros__total">
                  Total <MontoEquivalente cents={totalCargos} tasas={tasas} />
                </span>
              </header>
              {cargos.length === 0 ? (
                <p className="parametros__hint">No hay cargos en el rango.</p>
              ) : (
                <div className="tabla-wrap">
                <table className="tabla-comp">
                  <thead>
                    <tr>
                      <th scope="col">Concepto</th>
                      <th scope="col">Fecha</th>
                      <th scope="col">Sede</th>
                      <th scope="col">Alumno</th>
                      <th scope="col" className="tabla-comp__monto-col">
                        Monto
                      </th>
                      <th scope="col">Estado</th>
                      <th scope="col" className="tabla-comp__acciones">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cargos.map((cargo) => (
                      <tr key={cargo.id}>
                        <td data-label="Concepto">
                          {CONCEPTOS_LABEL[cargo.concepto] ?? cargo.planNombre ?? cargo.concepto}
                        </td>
                        <td data-label="Fecha">{formatearFechaLarga(cargo.fecha)}</td>
                        <td data-label="Sede">{nombreSede[cargo.sedeId] ?? 'Sede'}</td>
                        <td data-label="Alumno">{cargo.alumnoNombre}</td>
                        <td data-label="Monto" className="tabla-comp__monto-col">
                          <MontoEquivalente cents={cargo.montoCents} tasas={tasas} />
                        </td>
                        <td data-label="Estado">
                          <span className={`badge badge--${cargo.estado}`}>
                            {cargo.estado === 'pagado' ? 'Pagado' : 'Pendiente'}
                          </span>
                        </td>
                        <td data-label="Acción" className="tabla-comp__acciones">
                          {esPendiente ? (
                            <AccionPagado
                              control={control}
                              ocupado={control.ocupado}
                              accion="marcar-cargo"
                              exito="Cargo marcado como pagado"
                              onConfirmar={(metodo) => pagarCargo(cargo, metodo)}
                            />
                          ) : (
                            <span className="cobros__meta">
                              {cargo.metodoPago ? (METODOS_LABEL[cargo.metodoPago] ?? cargo.metodoPago) : '—'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </section>

            <section className="cobros__bloque glass">
              <header className="cobros__cab">
                <h2 className="cobros__titulo">Pagos al profesor</h2>
                <span className="cobros__total">
                  Total <MontoEquivalente cents={totalPagos} tasas={tasas} />
                </span>
              </header>
              {pagos.length === 0 ? (
                <p className="parametros__hint">No hay pagos en el rango.</p>
              ) : (
                <div className="tabla-wrap">
                <table className="tabla-comp">
                  <thead>
                    <tr>
                      <th scope="col">Concepto</th>
                      <th scope="col">Fecha</th>
                      <th scope="col">Sede</th>
                      <th scope="col">Profesor</th>
                      <th scope="col" className="tabla-comp__monto-col">
                        Monto
                      </th>
                      <th scope="col">Estado</th>
                      <th scope="col" className="tabla-comp__acciones">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagos.map((pago) => (
                      <tr key={pago.id}>
                        <td data-label="Concepto">Pago al profesor</td>
                        <td data-label="Fecha">{formatearFechaLarga(pago.fecha)}</td>
                        <td data-label="Sede">{nombreSede[pago.sedeId] ?? 'Sede'}</td>
                        <td data-label="Profesor">{pago.profesorNombre}</td>
                        <td data-label="Monto" className="tabla-comp__monto-col">
                          <MontoEquivalente cents={pago.montoCents} tasas={tasas} />
                        </td>
                        <td data-label="Estado">
                          <span className={`badge badge--${pago.estado}`}>
                            {pago.estado === 'pagado' ? 'Pagado' : 'Pendiente'}
                          </span>
                        </td>
                        <td data-label="Acción" className="tabla-comp__acciones">
                          {esPendiente ? (
                            <AccionPagado
                              control={control}
                              ocupado={control.ocupado}
                              accion="marcar-pago-profesor"
                              exito="Pago al profesor marcado como pagado"
                              onConfirmar={(metodo) => pagarProfesor(pago, metodo)}
                            />
                          ) : (
                            <span className="cobros__meta">
                              {pago.metodoPago ? (METODOS_LABEL[pago.metodoPago] ?? pago.metodoPago) : '—'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </PageChrome>
  )
}
