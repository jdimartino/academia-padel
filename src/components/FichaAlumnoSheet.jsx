import { useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { FichaInvalidaError, actualizarAlumno, crearAlumno } from '../firebase/db'
import { CATEGORIAS, etiquetaCategoria } from '../lib/agenda'
import { hoyISO } from '../lib/fechas'
import { CloseIcon } from './Icons'

const TIPOS = [
  { valor: 'adulto', label: 'Adulto' },
  { valor: 'menor', label: 'Menor' },
]

const DOCUMENTOS = [
  { valor: '', label: 'Sin documento' },
  { valor: 'cedula', label: 'Cédula' },
  { valor: 'pasaporte', label: 'Pasaporte' },
]

const LIMITES = { nombre: 200, email: 200, telefono: 30, documento: 30, notas: 1000 }

/** Orden de los campos para enfocar el primero inválido. */
const ORDEN_CAMPOS = [
  'nombre',
  'apellidos',
  'documentoTipo',
  'contactoEmergencia',
  'fechaIngreso',
  'representanteNombre',
  'representanteApellidos',
]

function formDeAlumno(alumno) {
  return {
    nombre: alumno?.nombre ?? '',
    apellidos: alumno?.apellidos ?? '',
    tipo: alumno?.tipo ?? 'adulto',
    nivel: alumno?.nivel ?? '',
    telefono: alumno?.telefono ?? '',
    documentoTipo: alumno?.documento?.tipo ?? '',
    documentoNumero: alumno?.documento?.numero ?? '',
    email: alumno?.email ?? '',
    contactoNombre: alumno?.contactoEmergencia?.nombre ?? '',
    contactoTelefono: alumno?.contactoEmergencia?.telefono ?? '',
    fechaIngreso: alumno?.fechaIngreso ?? hoyISO(),
    notas: alumno?.notas ?? '',
    representanteNombre: alumno?.representante?.nombre ?? '',
    representanteApellidos: alumno?.representante?.apellidos ?? '',
    representanteEmail: alumno?.representante?.email ?? '',
    representanteTelefono: alumno?.representante?.telefono ?? '',
    activo: alumno?.activo !== false,
  }
}

/** Validación propia del formulario: no depende de la validación nativa. */
function validar(form) {
  const errores = {}
  const nombre = form.nombre.trim()
  const apellidos = form.apellidos.trim()

  if (!nombre) errores.nombre = 'Escribe el nombre'
  else if (nombre.length > LIMITES.nombre) {
    errores.nombre = `El nombre no puede superar ${LIMITES.nombre} caracteres`
  }
  if (!apellidos) errores.apellidos = 'Escribe los apellidos'
  else if (apellidos.length > LIMITES.nombre) {
    errores.apellidos = `Los apellidos no pueden superar ${LIMITES.nombre} caracteres`
  }

  const docTipo = form.documentoTipo
  const docNumero = form.documentoNumero.trim()
  if ((docTipo && !docNumero) || (!docTipo && docNumero)) {
    errores.documentoTipo = 'Completa el tipo y el numero del documento'
  } else if (docNumero.length > LIMITES.documento) {
    errores.documentoTipo = `El numero del documento no puede superar ${LIMITES.documento} caracteres`
  }

  const contactoNombre = form.contactoNombre.trim()
  const contactoTelefono = form.contactoTelefono.trim()
  if ((contactoNombre && !contactoTelefono) || (!contactoNombre && contactoTelefono)) {
    errores.contactoEmergencia = 'Completa el nombre y el telefono del contacto de emergencia'
  }

  if (form.telefono.trim().length > LIMITES.telefono) {
    errores.telefono = `El telefono no puede superar ${LIMITES.telefono} caracteres`
  }
  if (form.email.trim().length > LIMITES.email) {
    errores.email = `El email no puede superar ${LIMITES.email} caracteres`
  }
  if (form.notas.length > LIMITES.notas) {
    errores.notas = `Las notas no pueden superar ${LIMITES.notas} caracteres`
  }
  if (!form.fechaIngreso) errores.fechaIngreso = 'Elige la fecha de ingreso'

  if (form.tipo === 'menor') {
    if (!form.representanteNombre.trim()) {
      errores.representanteNombre = 'Escribe el nombre del representante'
    }
    if (!form.representanteApellidos.trim()) {
      errores.representanteApellidos = 'Escribe los apellidos del representante'
    }
  }
  return errores
}

/*
 * Alta/edición de una ficha de alumno en un sheet glass-strong. El toggle de
 * tipo muestra u oculta el bloque del representante (menores). No hay borrado
 * físico: el toggle "Activo" apagado es el soft delete (activo:false).
 * La validación es propia (noValidate) y el foco va al primer campo inválido.
 */
export default function FichaAlumnoSheet({ tenantId, alumno = null, onClose, onSaved }) {
  const { user } = useAuth()
  const [form, setForm] = useState(() => formDeAlumno(alumno))
  const [errores, setErrores] = useState({})
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const campos = useRef({})

  const set = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }))
    setErrores((prev) => {
      const claves = [campo]
      if (campo === 'contactoNombre' || campo === 'contactoTelefono') {
        claves.push('contactoEmergencia')
      }
      if (campo === 'documentoNumero') claves.push('documentoTipo')
      if (!claves.some((clave) => prev[clave])) return prev
      const siguiente = { ...prev }
      for (const clave of claves) siguiente[clave] = undefined
      return siguiente
    })
  }

  function primerInvalido(erroresNuevos) {
    const clave = ORDEN_CAMPOS.find((campo) => erroresNuevos[campo])
    if (clave) campos.current[clave]?.focus()
  }

  async function enviar(event) {
    event.preventDefault()
    setError('')
    const erroresNuevos = validar(form)
    setErrores(erroresNuevos)
    if (Object.keys(erroresNuevos).length > 0) {
      // No se toca la capa de datos mientras haya campos inválidos.
      primerInvalido(erroresNuevos)
      return
    }

    setEnviando(true)
    try {
      const datos = {
        nombre: form.nombre.trim(),
        apellidos: form.apellidos.trim(),
        tipo: form.tipo,
        nivel: form.nivel || null,
        telefono: form.telefono.trim() || null,
        documento:
          form.documentoTipo && form.documentoNumero.trim()
            ? { tipo: form.documentoTipo, numero: form.documentoNumero.trim() }
            : null,
        email: form.email.trim() || null,
        contactoEmergencia:
          form.contactoNombre.trim() && form.contactoTelefono.trim()
            ? {
                nombre: form.contactoNombre.trim(),
                telefono: form.contactoTelefono.trim(),
              }
            : null,
        fechaIngreso: form.fechaIngreso,
        notas: form.notas,
        avisosActivos: alumno?.avisosActivos ?? true,
        activo: form.activo,
      }
      if (form.tipo === 'menor') {
        datos.representante = {
          nombre: form.representanteNombre.trim(),
          apellidos: form.representanteApellidos.trim(),
          email: form.representanteEmail.trim() || null,
          telefono: form.representanteTelefono.trim() || null,
        }
      }
      const opciones = { uid: user?.uid ?? null }
      if (alumno) {
        await actualizarAlumno(db, tenantId, alumno.id, datos, opciones)
      } else {
        await crearAlumno(db, tenantId, datos, opciones)
      }
      onSaved?.()
    } catch (err) {
      setError(
        err instanceof FichaInvalidaError
          ? err.message
          : 'No se pudo guardar la ficha. Intenta de nuevo.',
      )
    } finally {
      setEnviando(false)
    }
  }

  const errorDe = (campo) => errores[campo]
  const propsError = (campo, id) => ({
    'aria-invalid': Boolean(errorDe(campo)),
    'aria-describedby': errorDe(campo) ? id : undefined,
  })
  const mensaje = (campo, id) =>
    errorDe(campo) ? (
      <p className="form__error" id={id} role="alert">
        {errorDe(campo)}
      </p>
    ) : null

  return (
    <aside
      className="sheet sheet--ficha glass-strong"
      role="dialog"
      aria-label={alumno ? 'Editar alumno' : 'Nuevo alumno'}
    >
      <header className="sheet__head">
        <div>
          <h2 className="sheet__titulo">{alumno ? 'Editar alumno' : 'Nuevo alumno'}</h2>
          <p className="sheet__subtitulo">Datos de contacto: solo administración</p>
        </div>
        <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose} autoFocus>
          <CloseIcon />
        </button>
      </header>

      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="form" onSubmit={enviar} noValidate>
        <div className="form__field">
          <label className="form__label" htmlFor="fa-nombre">
            Nombre
          </label>
          <input
            className="form__input"
            id="fa-nombre"
            value={form.nombre}
            onChange={(event) => set('nombre', event.target.value)}
            ref={(el) => {
              campos.current.nombre = el
            }}
            {...propsError('nombre', 'fa-nombre-error')}
          />
          {mensaje('nombre', 'fa-nombre-error')}
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fa-apellidos">
            Apellidos
          </label>
          <input
            className="form__input"
            id="fa-apellidos"
            value={form.apellidos}
            onChange={(event) => set('apellidos', event.target.value)}
            ref={(el) => {
              campos.current.apellidos = el
            }}
            {...propsError('apellidos', 'fa-apellidos-error')}
          />
          {mensaje('apellidos', 'fa-apellidos-error')}
        </div>

        <div className="form__field">
          <span className="form__label">Tipo</span>
          <div className="chips-row">
            {TIPOS.map((tipo) => (
              <button
                type="button"
                key={tipo.valor}
                className={`chip-cancha${form.tipo === tipo.valor ? ' is-sel' : ''}`}
                aria-pressed={form.tipo === tipo.valor}
                onClick={() => set('tipo', tipo.valor)}
              >
                {tipo.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fa-nivel">
            Nivel (opcional)
          </label>
          <select
            className="form__input"
            id="fa-nivel"
            value={form.nivel}
            onChange={(event) => set('nivel', event.target.value)}
          >
            <option value="">Sin nivel</option>
            {CATEGORIAS.map((valor) => (
              <option key={valor} value={valor}>
                {etiquetaCategoria(valor)}
              </option>
            ))}
          </select>
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fa-telefono">
            Teléfono (opcional)
          </label>
          <input
            className="form__input"
            id="fa-telefono"
            type="tel"
            value={form.telefono}
            onChange={(event) => set('telefono', event.target.value)}
            {...propsError('telefono', 'fa-telefono-error')}
          />
          {mensaje('telefono', 'fa-telefono-error')}
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fa-documento-tipo">
            Documento (opcional)
          </label>
          <select
            className="form__input"
            id="fa-documento-tipo"
            value={form.documentoTipo}
            onChange={(event) => set('documentoTipo', event.target.value)}
            ref={(el) => {
              campos.current.documentoTipo = el
            }}
            {...propsError('documentoTipo', 'fa-documento-error')}
          >
            {DOCUMENTOS.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>
                {opcion.label}
              </option>
            ))}
          </select>
          <input
            className="form__input"
            aria-label="Número de documento"
            placeholder="Número de documento"
            value={form.documentoNumero}
            onChange={(event) => set('documentoNumero', event.target.value)}
            {...propsError('documentoTipo', 'fa-documento-error')}
          />
          {mensaje('documentoTipo', 'fa-documento-error')}
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fa-email">
            Email (opcional)
          </label>
          <input
            className="form__input"
            id="fa-email"
            type="email"
            value={form.email}
            onChange={(event) => set('email', event.target.value)}
            {...propsError('email', 'fa-email-error')}
          />
          {mensaje('email', 'fa-email-error')}
        </div>

        <fieldset className="contacto-box">
          <legend className="form__label">Contacto de emergencia (opcional)</legend>
          <div className="form__field">
            <label className="form__label" htmlFor="fa-contacto-nombre">
              Nombre del contacto
            </label>
            <input
              className="form__input"
              id="fa-contacto-nombre"
              value={form.contactoNombre}
              onChange={(event) => set('contactoNombre', event.target.value)}
              ref={(el) => {
                campos.current.contactoEmergencia = el
              }}
              {...propsError('contactoEmergencia', 'fa-contacto-error')}
            />
          </div>
          <div className="form__field">
            <label className="form__label" htmlFor="fa-contacto-tel">
              Teléfono del contacto
            </label>
            <input
              className="form__input"
              id="fa-contacto-tel"
              type="tel"
              value={form.contactoTelefono}
              onChange={(event) => set('contactoTelefono', event.target.value)}
              {...propsError('contactoEmergencia', 'fa-contacto-error')}
            />
          </div>
          {mensaje('contactoEmergencia', 'fa-contacto-error')}
        </fieldset>

        <div className="form__field">
          <label className="form__label" htmlFor="fa-fecha-ingreso">
            Fecha de ingreso
          </label>
          <input
            className="form__input"
            id="fa-fecha-ingreso"
            type="date"
            value={form.fechaIngreso}
            onChange={(event) => set('fechaIngreso', event.target.value)}
            ref={(el) => {
              campos.current.fechaIngreso = el
            }}
            {...propsError('fechaIngreso', 'fa-fecha-ingreso-error')}
          />
          {mensaje('fechaIngreso', 'fa-fecha-ingreso-error')}
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fa-notas">
            Notas internas (opcional)
          </label>
          <textarea
            className="form__input"
            id="fa-notas"
            rows={3}
            value={form.notas}
            onChange={(event) => set('notas', event.target.value)}
            {...propsError('notas', 'fa-notas-error')}
          />
          {mensaje('notas', 'fa-notas-error')}
        </div>

        {form.tipo === 'menor' ? (
          <fieldset className="representante-box">
            <legend className="form__label">
              Representante (los avisos van al representante)
            </legend>
            <div className="form__field">
              <label className="form__label" htmlFor="fa-representante-nombre">
                Nombre del representante
              </label>
              <input
                className="form__input"
                id="fa-representante-nombre"
                value={form.representanteNombre}
                onChange={(event) => set('representanteNombre', event.target.value)}
                ref={(el) => {
                  campos.current.representanteNombre = el
                }}
                {...propsError('representanteNombre', 'fa-representante-nombre-error')}
              />
              {mensaje('representanteNombre', 'fa-representante-nombre-error')}
            </div>
            <div className="form__field">
              <label className="form__label" htmlFor="fa-representante-apellidos">
                Apellidos del representante
              </label>
              <input
                className="form__input"
                id="fa-representante-apellidos"
                value={form.representanteApellidos}
                onChange={(event) => set('representanteApellidos', event.target.value)}
                ref={(el) => {
                  campos.current.representanteApellidos = el
                }}
                {...propsError('representanteApellidos', 'fa-representante-apellidos-error')}
              />
              {mensaje('representanteApellidos', 'fa-representante-apellidos-error')}
            </div>
            <div className="form__field">
              <label className="form__label" htmlFor="fa-representante-email">
                Email del representante (opcional)
              </label>
              <input
                className="form__input"
                id="fa-representante-email"
                type="email"
                value={form.representanteEmail}
                onChange={(event) => set('representanteEmail', event.target.value)}
              />
            </div>
            <div className="form__field">
              <label className="form__label" htmlFor="fa-representante-tel">
                Teléfono del representante (opcional)
              </label>
              <input
                className="form__input"
                id="fa-representante-tel"
                type="tel"
                value={form.representanteTelefono}
                onChange={(event) => set('representanteTelefono', event.target.value)}
              />
            </div>
          </fieldset>
        ) : null}

        <label className="toggle">
          <input
            type="checkbox"
            checked={form.activo}
            onChange={(event) => set('activo', event.target.checked)}
          />
          <span>Activo</span>
        </label>

        <button className="btn" type="submit" disabled={enviando}>
          {enviando ? 'Guardando…' : alumno ? 'Guardar cambios' : 'Crear alumno'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          Cancelar
        </button>
      </form>
    </aside>
  )
}
