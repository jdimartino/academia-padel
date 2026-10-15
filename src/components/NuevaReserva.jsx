import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAvisos } from '../context/AvisosContext'
import { db } from '../firebase/config'
import {
  crearClase,
  getProfesores,
  horarioDeSede,
  horarioDelDia,
  nombreCompleto,
  reprogramarClase,
} from '../firebase/db'
import {
  CATEGORIAS,
  CATEGORIAS_GRUPO,
  aHoraHHmm,
  aMinutos,
  etiquetaCategoria,
  etiquetaCategoriaGrupo,
  etiquetaDuracion,
  formatHora12,
  formatMinutos,
  opcionesDeInicio,
} from '../lib/agenda'
import {
  MOTIVOS_AJUSTE,
  PARAMETROS_DEFAULT,
  perfilPorCupo,
  sugerirPrecioCents,
} from '../lib/cobros'
import { formatearUSD, parsearUSD } from '../lib/dinero'
import { hayCambios } from '../lib/avisos'
import { formatearFechaLarga } from '../lib/fechas'
import useCierreSeguro from '../hooks/useCierreSeguro'
import { CloseIcon } from './Icons'
import SelectorAlumnos from './SelectorAlumnos'

const MODALIDADES = ['Grupal', 'Individual']

/** Etiquetas de los motivos de ajuste del precio. */
const MOTIVOS_LABEL = {
  descuento: 'Descuento',
  cortesia: 'Cortesía',
  acuerdo: 'Acuerdo',
  otro: 'Otro',
}

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
  parametros = null,
  perfiles = null,
  onClose,
  onCreated,
}) {
  const { user } = useAuth()
  const esEdicion = Boolean(clase)
  const duraciones = parametros?.duracionesPermitidas ?? PARAMETROS_DEFAULT.duracionesPermitidas
  /*
   * Horario de la sede: el formulario solo ofrece horas dentro del horario del
   * DÍA que se está reservando (puede estar cerrado, con horarios distintos por
   * día de la semana). `franja` es `null` cuando la sede está cerrada ese día.
   */
  const semana = useMemo(() => horarioDeSede(sede), [sede])
  const franja = useMemo(() => horarioDelDia(fecha, semana), [fecha, semana])
  // Inicios posibles con la duración MÁS CORTA: sirve de default cuando todavía
  // no hay duración elegida (una reserva nueva arranca con la primera opción).
  const iniciosBase = opcionesDeInicio(duraciones[0], franja)
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
  // Una reserva nueva (con hueco o sin él) usa la primera duración permitida.
  // Al reprogramar se toma la duración REAL de la clase (60, 90, 120…), que se
  // agrega a las opciones si los parámetros ya no la incluyen.
  const [duracion, setDuracion] = useState(
    clase ? (aMinutos(clase.horaFin) ?? 0) - (aMinutos(clase.horaInicio) ?? 0) : duraciones[0],
  )
  const opcionesDuracion = useMemo(() => {
    const lista = [...duraciones]
    if (duracion && !lista.includes(duracion)) lista.push(duracion)
    return lista.sort((a, b) => a - b)
  }, [duraciones, duracion])
  const [modalidad, setModalidad] = useState((clase?.cupo ?? 4) <= 1 ? 'Individual' : 'Grupal')
  // El usuario tocó el perfil de cobro a mano: la modalidad ya no lo sigue.
  const perfilTocado = useRef(false)
  const [categoria, setCategoria] = useState(clase?.categoria ?? '')
  // Categoría de GRUPO (infantil | junior | adulto), opcional y distinta del
  // nivel de `categoria`. Vacío = sin categoría de grupo (null).
  const [categoriaGrupo, setCategoriaGrupo] = useState(clase?.categoriaGrupo ?? '')
  const [profesorId, setProfesorId] = useState(clase?.profesorId ?? null)
  const [profesores, setProfesores] = useState(null)
  const [alumnosSel, setAlumnosSel] = useState(() => {
    const ids = clase?.alumnos ?? []
    const nombres = clase?.alumnoNombres ?? []
    return ids.map((id, i) => ({ id, nombre: nombres[i] ?? 'Alumno' }))
  })
  /*
   * Cobro: perfil elegido (o "Sin precio"), monto en USD y motivo de ajuste. El
   * perfil se preselecciona por cupo con `perfilPorCupo`; el monto sigue la
   * sugerencia mientras no se ajuste a mano.
   */
  const perfilesActivos = useMemo(
    () => (perfiles ?? []).filter((perfil) => perfil.activo !== false),
    [perfiles],
  )
  const [perfilCobroId, setPerfilCobroId] = useState(
    () => clase?.cobro?.perfilCobroId ?? perfilPorCupo(perfilesActivos, clase?.cupo ?? 4)?.id ?? null,
  )
  const [montoTexto, setMontoTexto] = useState(() =>
    clase?.cobro ? formatearUSD(clase.cobro.montoCents) : '',
  )
  const [motivoAjuste, setMotivoAjuste] = useState(
    clase?.cobro?.ajustado ? (clase.cobro.motivoAjuste ?? '') : '',
  )
  const [ajustadoManual, setAjustadoManual] = useState(Boolean(clase?.cobro?.ajustado))
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
      categoriaGrupo,
      profesorId,
      alumnos: alumnosSel.map((alumno) => alumno.id),
      cobro: { perfilCobroId, montoTexto, ajustado: ajustadoManual, motivoAjuste },
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

  /*
   * Cobro: perfil elegido y tarifa por hora en la sede. `sugeridoCents` es el
   * monto que sale de la tarifa × duración (× personas si el modo es
   * `por_persona`); es `null` cuando la sede no tiene tarifa para ese perfil.
   */
  const perfil = perfilesActivos.find((p) => p.id === perfilCobroId) ?? null
  const tarifaHoraCents = perfil ? (sede?.tarifas?.[perfil.id] ?? null) : null
  const sugeridoCents =
    perfil && Number.isInteger(tarifaHoraCents)
      ? sugerirPrecioCents({
          tarifaHoraCents,
          duracionMin: duracion,
          modo: perfil.modo,
          cantidadAlumnos: alumnosSel.length,
        })
      : null
  const montoCents = parsearUSD(montoTexto)
  // ¿El monto final difiere del sugerido? Sin tarifa de sede, cualquier monto
  // escrito es "ajustado" (no hay estándar con el que comparar).
  const cobroAjustado = montoCents != null && montoCents !== sugeridoCents
  const cobro = perfil
    ? {
        perfilCobroId: perfil.id,
        modo: perfil.modo,
        tarifaHoraCents: Number.isInteger(tarifaHoraCents) ? tarifaHoraCents : null,
        montoEstandarCents: sugeridoCents,
        montoCents: montoCents ?? 0,
        ajustado: cobroAjustado,
        motivoAjuste: cobroAjustado ? (motivoAjuste || null) : null,
      }
    : null
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
   * Inicios ofrecidos: cada MINUTOS_BLOQUE (30 min) dentro del horario del DÍA
   * de la sede (vacío si ese día está cerrado), filtrando los que no caben antes
   * del cierre con la duración elegida y los que chocan con otra clase del día
   * en la misma cancha o con el mismo profesor. Al cambiar la duración (o la
   * cancha o el profesor) la lista se recalcula sola.
   */
  const horas = useMemo(
    () => opcionesDeInicio(duracion, franja, clasesQueOcupan),
    [duracion, franja, clasesQueOcupan],
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
   * Al cambiar la duración (o la franja del día, o la cancha/profesor), la
   * hora elegida podría quedar fuera de la lista de inicios posibles. Si sigue
   * estando se conserva TAL CUAL (así el hueco precargado por clic mantiene su
   * media hora exacta); si no, se cae a la última hora que sí cabe.
   */
  useEffect(() => {
    setHoraInicio((hora) => (horas.includes(hora) ? hora : (horas[horas.length - 1] ?? hora)))
    // `horas` se recalcula con la duración, el horario del día, la cancha y el
    // profesor; solo interesa cuando cambia la lista resultante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horas])

  /*
   * El monto sigue la sugerencia mientras el usuario no la ajuste a mano. Al
   * cambiar de perfil, de duración o de cantidad de alumnos se recalcula solo.
   */
  useEffect(() => {
    if (ajustadoManual) return
    setMontoTexto(sugeridoCents == null ? '' : formatearUSD(sugeridoCents))
  }, [sugeridoCents, ajustadoManual])

  // Al cambiar de modalidad la selección no puede quedar por encima del cupo.
  function elegirModalidad(opcion) {
    const nuevoCupo = opcion === 'Individual' ? 1 : 4
    setModalidad(opcion)
    setAlumnosSel((prev) => (prev.length > nuevoCupo ? prev.slice(0, nuevoCupo) : prev))
    // Si el usuario no eligió perfil a mano, la modalidad arrastra el que encaja.
    if (!perfilTocado.current) setPerfilCobroId(perfilPorCupo(perfilesActivos, nuevoCupo)?.id ?? null)
  }

  /** Cambia el perfil de cobro a mano ('' = sin precio). */
  function elegirPerfil(id) {
    perfilTocado.current = true
    setPerfilCobroId(id || null)
    setAjustadoManual(false)
    setMotivoAjuste('')
  }

  /** El usuario escribe un monto: deja de seguir la sugerencia. */
  function ajustarMonto(texto) {
    setMontoTexto(texto)
    setAjustadoManual(true)
  }

  /** Vuelve al monto sugerido por la tarifa de la sede. */
  function usarSugerido() {
    setAjustadoManual(false)
    setMotivoAjuste('')
  }

  const problemas = useMemo(() => {
    const lista = []
    if (franja === null) {
      lista.push('La sede está cerrada ese día: no se pueden reservar clases.')
    } else {
      if (inicio < franja.apertura) {
        lista.push(`La clase no puede empezar antes de las ${formatMinutos(franja.apertura)}.`)
      }
      if (fin > franja.cierre) {
        lista.push(`La clase no puede terminar después de las ${formatMinutos(franja.cierre)}.`)
      }
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
    // Con un perfil elegido hace falta un monto válido (o pasar a "Sin precio").
    if (perfil && montoCents == null) {
      lista.push('Escribí un monto para la clase o elegí "Sin precio".')
    }
    return lista
  }, [canchaId, fin, inicio, otrasClases, profesor, profesorId, franja, perfil, montoCents])

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
        categoriaGrupo: categoriaGrupo || null,
        alumnos: alumnosSel.map((alumno) => alumno.id),
        cobro,
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
            {opcionesDuracion.map((minutos) => (
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
          <label className="form__label" htmlFor="nr-categoria-grupo">
            Categoría de grupo (opcional)
          </label>
          <select
            className="form__input"
            id="nr-categoria-grupo"
            value={categoriaGrupo}
            onChange={(e) => setCategoriaGrupo(e.target.value)}
          >
            <option value="">Sin categoría de grupo</option>
            {CATEGORIAS_GRUPO.map((valor) => (
              <option key={valor} value={valor}>
                {etiquetaCategoriaGrupo(valor)}
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

        {perfilesActivos.length > 0 ? (
          <div className="form__field">
            <label className="form__label" htmlFor="nr-perfil">
              Precio
            </label>
            <select
              className="form__input"
              id="nr-perfil"
              value={perfilCobroId ?? ''}
              onChange={(e) => elegirPerfil(e.target.value)}
            >
              <option value="">Sin precio</option>
              {perfilesActivos.map((opcion) => (
                <option key={opcion.id} value={opcion.id}>
                  {opcion.nombre}
                </option>
              ))}
            </select>

            {perfil ? (
              <>
                <label className="form__label" htmlFor="nr-monto">
                  Monto de la clase (USD)
                </label>
                <input
                  className="form__input"
                  id="nr-monto"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={montoTexto}
                  onChange={(e) => ajustarMonto(e.target.value)}
                />
                {sugeridoCents == null ? (
                  <p className="aviso">
                    Esta sede no tiene tarifa para "{perfil.nombre}": escribí el monto a mano.
                  </p>
                ) : (
                  <p className="aviso">
                    Sugerido: {formatearUSD(sugeridoCents)}
                    {cobroAjustado ? (
                      <>
                        {' '}
                        <button type="button" className="link-btn" onClick={usarSugerido}>
                          Usar sugerido
                        </button>
                      </>
                    ) : null}
                  </p>
                )}
                {cobroAjustado ? (
                  <>
                    <label className="form__label" htmlFor="nr-motivo">
                      Motivo del ajuste
                    </label>
                    <select
                      className="form__input"
                      id="nr-motivo"
                      value={motivoAjuste}
                      onChange={(e) => setMotivoAjuste(e.target.value)}
                    >
                      <option value="">Sin motivo</option>
                      {MOTIVOS_AJUSTE.map((valor) => (
                        <option key={valor} value={valor}>
                          {MOTIVOS_LABEL[valor] ?? valor}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}
              </>
            ) : (
              <p className="aviso">Esta clase se guarda sin precio.</p>
            )}
          </div>
        ) : null}

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
