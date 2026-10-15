import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import MontoEquivalente from '../components/MontoEquivalente'
import PageChrome from '../components/PageChrome'
import TasasPanel from '../components/TasasPanel'
import { useAuth } from '../context/AuthContext'
import { useAvisos } from '../context/AvisosContext'
import { useTasas } from '../context/TasasContext'
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

/** Selector de método de pago + confirmación, en línea. */
function AccionPagado({ onConfirmar, ocupado }) {
  const [abierto, setAbierto] = useState(false)
  const [metodoPago, setMetodoPago] = useState('efectivo')

  if (!abierto) {
    return (
      <button type="button" className="btn btn--secondary" disabled={ocupado} onClick={() => setAbierto(true)}>
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
      <button
        type="button"
        className="btn-cta"
        disabled={ocupado}
        onClick={() => onConfirmar(metodoPago)}
      >
        Confirmar
      </button>
      <button type="button" className="btn btn--secondary" disabled={ocupado} onClick={() => setAbierto(false)}>
        Cancelar
      </button>
    </div>
  )
}

/**
 * Cobros pendientes (Phase 4): cargos de alumnos y pagos al profesor que
 * todavía no se cobraron. Se filtran por sede y rango de fechas y cada fila
 * permite marcar pagado (pago completo) eligiendo el método.
 */
export default function Cobros() {
  const { academia } = useParams()
  const { user } = useAuth()
  const { mostrarExito, mostrarErrorTecnico } = useAvisos()
  const { tasas } = useTasas()
  const uid = user?.uid ?? null

  const [sedes, setSedes] = useState([])
  const [sedeId, setSedeId] = useState('')
  const [desde, setDesde] = useState(sumarDias(hoyISO(), -30))
  const [hasta, setHasta] = useState(hoyISO())

  const [cargos, setCargos] = useState(null)
  const [pagos, setPagos] = useState(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    listarSedes(db, academia)
      .then(setSedes)
      .catch(() => setSedes([]))
  }, [academia])

  const recargar = useCallback(() => {
    const filtros = { sedeId: sedeId || null, desde, hasta }
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
  }, [academia, sedeId, desde, hasta])

  useEffect(() => {
    recargar()
  }, [recargar])

  async function pagarCargo(cargo, metodoPago) {
    setOcupado(true)
    try {
      await marcarCargoPagado(db, academia, cargo.id, { metodoPago }, { uid })
      mostrarExito('Cargo marcado como pagado')
      await recargar()
    } catch (err) {
      mostrarErrorTecnico('marcar-cargo', err)
    } finally {
      setOcupado(false)
    }
  }

  async function pagarProfesor(pago, metodoPago) {
    setOcupado(true)
    try {
      await marcarPagoProfesorPagado(db, academia, pago.id, { metodoPago }, { uid })
      mostrarExito('Pago al profesor marcado como pagado')
      await recargar()
    } catch (err) {
      mostrarErrorTecnico('marcar-pago-profesor', err)
    } finally {
      setOcupado(false)
    }
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

  return (
    <PageChrome titulo="Cobros pendientes">
      <TasasPanel />
      <div className="config glass">
        <div className="cobros__filtros">
          <label className="parametros__campo">
            <span className="form__label">Sede</span>
            <select className="form__input" value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
              <option value="">Todas</option>
              {sedes.map((sede) => (
                <option key={sede.id} value={sede.id}>
                  {sede.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="parametros__campo">
            <span className="form__label">Desde</span>
            <input className="form__input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="parametros__campo">
            <span className="form__label">Hasta</span>
            <input className="form__input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
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
          <>
            <section className="cobros__bloque">
              <h2 className="lista-sedes__titulo">
                Cargos de alumnos{' '}
                <MontoEquivalente cents={totalCargos} tasas={tasas} className="cobros__total" />
              </h2>
              {cargos.length === 0 ? (
                <p className="parametros__hint">No hay cargos pendientes en el rango.</p>
              ) : (
                <ul className="cobros__lista">
                  {cargos.map((cargo) => (
                    <li key={cargo.id} className="cobros__fila">
                      <span className="cobros__nombre">
                        {cargo.alumnoNombre}
                        <span className="cobros__meta">
                          {cargo.concepto === 'falta_sin_aviso'
                            ? 'Falta sin aviso'
                            : cargo.concepto === 'mensualidad'
                              ? (cargo.planNombre ?? 'Mensualidad')
                              : 'Clase'}{' '}
                          · {formatearFechaLarga(cargo.fecha)}
                        </span>
                      </span>
                      <span className="cobros__monto">
                        <MontoEquivalente cents={cargo.montoCents} tasas={tasas} />
                      </span>
                      <AccionPagado ocupado={ocupado} onConfirmar={(metodo) => pagarCargo(cargo, metodo)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="cobros__bloque">
              <h2 className="lista-sedes__titulo">
                Pagos al profesor{' '}
                <MontoEquivalente cents={totalPagos} tasas={tasas} className="cobros__total" />
              </h2>
              {pagos.length === 0 ? (
                <p className="parametros__hint">No hay pagos pendientes en el rango.</p>
              ) : (
                <ul className="cobros__lista">
                  {pagos.map((pago) => (
                    <li key={pago.id} className="cobros__fila">
                      <span className="cobros__nombre">
                        {pago.profesorNombre}
                        <span className="cobros__meta">{formatearFechaLarga(pago.fecha)}</span>
                      </span>
                      <span className="cobros__monto">
                        <MontoEquivalente cents={pago.montoCents} tasas={tasas} />
                      </span>
                      <AccionPagado
                        ocupado={ocupado}
                        onConfirmar={(metodo) => pagarProfesor(pago, metodo)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </PageChrome>
  )
}
