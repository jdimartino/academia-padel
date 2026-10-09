import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAvisos } from '../context/AvisosContext'
import { db } from '../firebase/config'
import {
  crearClase,
  getProfesores,
  horarioDeSede,
  nombreCompleto,
  reprogramarClase,
} from '../firebase/db'
import {
  CATEGORIAS,
  DURACIONES_VALIDAS,
  aHoraHHmm,
  aMinutos,
  etiquetaCategoria,
  etiquetaDuracion,
  formatHora12,
  opcionesDeInicio,
} from '../lib/agenda'
import { hayCambios } from '../lib/avisos'
import { formatearFechaLarga } from '../lib/fechas'
import useCierreSeguro from '../hooks/useCierreSeguro'
import { CloseIcon } from './Icons'
import SelectorAlumnos from './SelectorAlumnos'

const MODALIDADES = ['Grupal', 'Individual']

/*
 * Formulario de reserva. Con `clase` hace de reprogramación (prefill + update
 * transaccional); sin `clase` crea una reserva nueva. Mismo sheet de vidrio
 * que el detalle: bottom sheet en mobile y panel de 360px en desktop.
 * La validación de choques se hace ANTES de enviar contra las clases ya
 * cargadas del día; la transacción de db.js vuelve a validar igual.
 *
 * `hueco` (opcional) es una reserva nueva prellenada desde el clic en un bloque
 * libre de la agenda: `{canchaId, horaInicio}` en el formato interno de 24 h
 * (puede caer en media hora), duración 1 h. Se aplica en los valores INICIALES
 * del estado, así la foto de `instantanea()` (la del cierre seguro) ya los
 * incluye: un formulario recién abierto cierra directo con Escape, sin "¿Salir
 * sin guardar?".
 */
export default function NuevaReserva({
  tenantId,
  sede,
  canchas = [],
  fecha,
  clases,
  clase = null,
  hueco = null,
  onClose,
  onCreated,
}) {
  const { user } = useAuth()
  const esEdicion = Boolean(clase)
  // Franja de la sede: el formulario solo ofrece horas dentro de su horario.
  const horario = useMemo(() => horarioDeSede(sede), [sede])
  // Inicios posibles con la duración MÁS CORTA: sirve de default cuando todavía
  // no hay duración elegida (una reserva nueva arranca en 60 min).
  const iniciosBase = opcionesDeInicio(DURACIONES_VALIDAS[0], horario)
  const [canchaId, setCanchaId] = useState(
    clase?.canchaId ?? hueco?.canchaId ?? canchas[0]?.id ?? null,
  )
  const [horaInicio, setHoraInicio] = useState(() => {
    if (clase?.horaInicio) return clase.horaInicio
    // El hueco del clic manda: conserva el inicio EXACTO, incluida la media hora.
    if (hueco?.horaInicio) return hueco.horaInicio
    // Default histórico 18:00; si la sede abre/cierra antes, la última hora útil.
    if (iniciosBase.includes('18:00')) return '18:00'
    return iniciosBase[iniciosBase.length - 1] ?? '07:00'
  })
  // Una reserva nueva (con hueco o sin él) dura 1 h, que ya es el default de acá.
  // Al reprogramar se toma la duración REAL de la clase (60, 90 o 120 min).
  const [duracion, setDuracion] = useState(
    clase ? (aMinutos(clase.horaFin) ?? 0) - (aMinutos(clase.horaInicio) ?? 0) : 60,
  )
  const [modalidad, setModalidad] = useState((clase?.cupo ?? 4) <= 1 ? 'Individual' : 'Grupal')
  const [categoria, setCategoria] = useState(clase?.categoria ?? '')
  const [profesorId, setProfesorId] = useState(clase?.profesorId ?? null)
  const [profesores, setProfesores] = useState(null)
  const [alumnosSel, setAlumnosSel] = useState(() => {
    const ids = clase?.alumnos ?? []
    const nombres = clase?.alumnoNombres ?? []
    return ids.map((id, i) => ({ id, nombre: nombres[i] ?? id }))
  })
  // Error de la LECTURA de profesores: se queda en línea (no es una acción).
  const [errorLectura, setErrorLectura] = useState('')
  const [enviando, setEnviando] = useState(false)
  // Último profesor elegido a mano: el que llega por defecto con la lectura no
  // cuenta como cambio del usuario.
  const profesorElegido = useRef(null)
  const { mostrarErrorTecnico, mostrarExito } = useAvisos()

  /** Valores que definen los cambios sin guardar del formulario. */
  function instantanea() {
    return {
      canchaId,
      horaInicio,
      duracion,
      modalidad,
      categoria,
      profesorId,
      alumnos: alumnosSel.map((alumno) => alumno.id),
    }
  }

  // Foto de los valores iniciales, tomada al abrir el formulario.
  const [inicial] = useState(instantanea)

  useEffect(() => {
    let activo = true
    // Solo los profesores asignados a la sede de la clase: la transacción de
    // db.js rechaza a cualquier otro.
    getProfesores(db, tenantId, { sedeId: sede?.id })
      .then((lista) => {
        if (!activo) return
        setProfesores(lista)
        // Si el profesor actual no dicta en esta sede, se cae al primero.
        setProfesorId((prev) => (lista.some((p) => p.id === prev) ? prev : (lista[0]?.id ?? null)))
      })
      .catch((err) => {
        if (!activo) return
        setProfesores([])
        setErrorLectura(err.message)
      })
    return () => {
      activo = false
    }
  }, [tenantId, sede?.id])
  const inicio = aMinutos(horaInicio) ?? 0
  const fin = inicio + duracion
  const cupo = modalidad === 'Individual' ? 1 : 4
  const profesor = profesores?.find((p) => p.id === profesorId) ?? null
  // Al reprogramar, la propia clase no cuenta como conflicto consigo misma.
  const otrasClases = useMemo(
    () => (esEdicion ? clases.filter((c) => c.id !== clase.id) : clases),
    [clases, clase?.id, esEdicion],
  )
  /*
   * Clases que le quitan horas de inicio a esta reserva: las de la cancha
   * elegida o las del profesor elegido (una clase de otra cancha con otro
   * profesor no bloquea nada). Se le pasan a `opcionesDeInicio`, que descarta
   * todo inicio que se solape con ellas.
   */
  const clasesQueOcupan = useMemo(
    () =>
      otrasClases.filter(
        (c) => c.estado !== 'cancelada' && (c.canchaId === canchaId || c.profesorId === profesorId),
      ),
    [otrasClases, canchaId, profesorId],
  )
  /*
   * Inicios ofrecidos: cada MINUTOS_BLOQUE (30 min) dentro del horario de la
   * sede, filtrando los que no caben antes del cierre con la duración elegida y
   * los que chocan con otra clase del día en la misma cancha o con el mismo
   * profesor. Al cambiar la duración (o la cancha o el profesor) la lista se
   * recalcula sola.
   */
  const horas = useMemo(
    () => opcionesDeInicio(duracion, horario, clasesQueOcupan),
    [duracion, horario, clasesQueOcupan],
  )

  /*
   * Opciones del selector de cancha: solo las ACTIVAS (la sede puede tener N).
   * Si al reprogramar la cancha actual quedó inactiva, se agrega igual para no
   * cambiar en silencio la cancha de la clase: se ve preseleccionada y el
   * guardado falla con el error de la transacción, como antes.
   */
  const canchasOpciones = useMemo(() => {
    const activas = canchas.filter((cancha) => cancha.activa !== false)
    if (canchaId && !activas.some((cancha) => cancha.id === canchaId)) {
      const actual = canchas.find((cancha) => cancha.id === canchaId)
      if (actual) return [...activas, actual]
    }
    return activas
  }, [canchas, canchaId])
  // Con la sede sin canchas activas no hay nada que elegir: no se puede guardar.
  const sinCanchasActivas = !canchas.some((cancha) => cancha.activa !== false)

  /*
   * Al cambiar la duración (o la franja de la sede, o la cancha/profesor), la
   * hora elegida podría quedar fuera de la lista de inicios posibles. Si sigue
   * estando se conserva TAL CUAL (así el hueco precargado por clic mantiene su
   * media hora exacta); si no, se cae a la última hora que sí cabe.
   */
  useEffect(() => {
    setHoraInicio((hora) => (horas.includes(hora) ? hora : (horas[horas.length - 1] ?? hora)))
    // `horas` se recalcula con la duración, el horario, la cancha y el profesor;
    // solo interesa cuando cambia la lista resultante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horas])

  // Al cambiar de modalidad la selección no puede quedar por encima del cupo.
  function elegirModalidad(opcion) {
    const nuevoCupo = opcion === 'Individual' ? 1 : 4
    setModalidad(opcion)
    setAlumnosSel((prev) => (prev.length > nuevoCupo ? prev.slice(0, nuevoCupo) : prev))
  }

  const problemas = useMemo(() => {
    const lista = []
    if (inicio < horario.apertura * 60) {
      lista.push(`La clase no puede empezar antes de las ${formatHora12(horario.apertura)}.`)
    }
    if (fin > horario.cierre * 60) {
      lista.push(`La clase no puede terminar después de las ${formatHora12(horario.cierre)}.`)
    }

    const solapan = (otra) => {
      const ci = aMinutos(otra.horaInicio)
      const cf = aMinutos(otra.horaFin)
      return ci !== null && cf !== null && ci < fin && inicio < cf
    }
    const canchaOcupada = otrasClases.find(
      (c) => c.canchaId === canchaId && c.estado !== 'cancelada' && solapan(c),
    )
    if (canchaOcupada) {
      lista.push(
        `La cancha ya está ocupada de ${formatHora12(canchaOcupada.horaInicio)} a ${formatHora12(canchaOcupada.horaFin)}.`,
      )
    }
    if (profesorId) {
      const profeOcupado = otrasClases.find(
        (c) => c.profesorId === profesorId && c.estado !== 'cancelada' && solapan(c),
      )
      if (profeOcupado) {
        lista.push(
          `${nombreCompleto(profesor) || 'El profesor'} ya tiene clase de ${formatHora12(profeOcupado.horaInicio)} a ${formatHora12(profeOcupado.horaFin)}.`,
        )
      }
    }
    return lista
  }, [canchaId, fin, inicio, otrasClases, profesor, profesorId, horario])

  const puedeEnviar = Boolean(canchaId && profesorId) && problemas.length === 0 && !enviando

  /*
   * Cambios sin guardar: la foto inicial (tomada al abrir) contra los valores
   * actuales. El profesor por defecto que trae la lectura no es un cambio; el
   * que elige el usuario sí.
   */
  const sucio = hayCambios(inicial, {
    ...instantanea(),
    profesorId: profesorElegido.current ?? inicial.profesorId,
  })

  // Escape (y el fondo, si lo hubiera) con cambios sin guardar pide confirmación.
  useCierreSeguro({ sucio, onCerrar: onClose })

  async function enviar(event) {
    event.preventDefault()
    if (!puedeEnviar) return
    const accion = esEdicion ? 'reprogramar-clase' : 'reservar-clase'
    setEnviando(true)
    try {
      const datos = {
        sedeId: sede.id,
        sedeNombre: sede.nombre,
        canchaId,
        profesorId,
        profesorNombre: nombreCompleto(profesor) || null,
        fecha,
        horaInicio,
        horaFin: aHoraHHmm(fin),
        cupo,
        categoria: categoria || null,
        alumnos: alumnosSel.map((alumno) => alumno.id),
      }
      let claseId
      if (esEdicion) {
        const resultado = await reprogramarClase(
          db,
          tenantId,
          clase.id,
          datos,
          { uid: user?.uid ?? null },
        )
        claseId = resultado.claseId
      } else {
        const resultado = await crearClase(db, tenantId, datos, { uid: user?.uid ?? null })
        claseId = resultado.claseId
      }
      mostrarExito(esEdicion ? 'Clase reprogramada' : 'Clase reservada')
      onCreated(claseId)
    } catch (err) {
      mostrarErrorTecnico(accion, err)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <aside className="sheet glass-strong" role="dialog" aria-label="Nueva reserva">
      <header className="sheet__head">
        <div>
          <h2 className="sheet__titulo">{esEdicion ? 'Reprogramar clase' : 'Nueva reserva'}</h2>
          <p className="sheet__subtitulo">
            {sede?.nombre} · {formatearFechaLarga(fecha)}
          </p>
        </div>
        <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose} autoFocus>
          <CloseIcon />
        </button>
      </header>

      {errorLectura ? (
        <p className="alert alert--error" role="alert">
          {errorLectura}
        </p>
      ) : null}
      {problemas.map((problema) => (
        <p key={problema} className="alert alert--error" role="alert">
          {problema}
        </p>
      ))}

      <form className="form" onSubmit={enviar}>
        <div className="form__field">
          <label className="form__label" htmlFor="nr-cancha">
            Cancha
          </label>
          <select
            className="form__input"
            id="nr-cancha"
            value={canchaId ?? ''}
            disabled={sinCanchasActivas}
            onChange={(e) => setCanchaId(e.target.value || null)}
          >
            {sinCanchasActivas ? <option value="">Sin canchas activas</option> : null}
            {canchasOpciones.map((cancha) => (
              <option key={cancha.id} value={cancha.id}>
                {cancha.nombre}
              </option>
            ))}
          </select>
          {sinCanchasActivas ? (
            <p className="alert alert--error" role="alert">
              Esta sede no tiene canchas activas. Actívalas en Configuración.
            </p>
          ) : null}
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="nr-hora">
            Hora de inicio
          </label>
          <select
            className="form__input"
            id="nr-hora"
            value={horaInicio}
            onChange={(e) => setHoraInicio(e.target.value)}
          >
            {horas.map((hora) => (
              <option key={hora} value={hora}>
                {formatHora12(hora)}
              </option>
            ))}
          </select>
        </div>

        <div className="form__field">
          <span className="form__label">Duración</span>
          <div className="chips-row">
            {DURACIONES_VALIDAS.map((minutos) => (
              <button
                type="button"
                key={minutos}
                className={`chip-cancha${minutos === duracion ? ' is-sel' : ''}`}
                aria-pressed={minutos === duracion}
                onClick={() => setDuracion(minutos)}
              >
                {etiquetaDuracion(minutos)}
              </button>
            ))}
          </div>
        </div>

        <div className="form__field">
          <span className="form__label">Modalidad</span>
          <div className="chips-row">
            {MODALIDADES.map((opcion) => (
              <button
                type="button"
                key={opcion}
                className={`chip-cancha${opcion === modalidad ? ' is-sel' : ''}`}
                aria-pressed={opcion === modalidad}
                onClick={() => elegirModalidad(opcion)}
              >
                {opcion}
              </button>
            ))}
          </div>
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="nr-categoria">
            Categoría (opcional)
          </label>
          <select
            className="form__input"
            id="nr-categoria"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            <option value="">Sin categoría</option>
            {CATEGORIAS.map((valor) => (
              <option key={valor} value={valor}>
                {etiquetaCategoria(valor)}
              </option>
            ))}
          </select>
        </div>

        <div className="form__field">
          <span className="form__label">Profesor</span>
          {profesores === null ? (
            <p className="aviso">Cargando profesores…</p>
          ) : profesores.length === 0 ? (
            <p className="aviso">No hay profesores asignados a esta sede.</p>
          ) : (
            <div className="chips-row">
              {profesores.map((profe) => (
                <button
                  type="button"
                  key={profe.id}
                  className={`chip-cancha${profe.id === profesorId ? ' is-sel' : ''}`}
                  aria-pressed={profe.id === profesorId}
                  onClick={() => {
                    profesorElegido.current = profe.id
                    setProfesorId(profe.id)
                  }}
                >
                  {nombreCompleto(profe)}
                </button>
              ))}
            </div>
          )}
        </div>

        <SelectorAlumnos
          tenantId={tenantId}
          cupo={cupo}
          seleccionados={alumnosSel}
          onChange={setAlumnosSel}
          clases={clases}
          claseId={clase?.id ?? null}
          horaInicio={horaInicio}
          horaFin={aHoraHHmm(fin)}
        />

        <button className="btn" type="submit" disabled={!puedeEnviar}>
          {enviando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Reservar clase'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          Cancelar
        </button>
      </form>
    </aside>
  )
}
