/*
 * Datos de muestra SOLO para juzgar el layout antes de conectar Firestore.
 * Block B los reemplaza por lecturas reales (src/firebase/db.js).
 */

export const SEDES_MUESTRA = [
  {
    id: 'traki',
    nombre: 'Traki',
    canchas: [
      { id: 'c1', nombre: 'Cancha 1' },
      { id: 'c2', nombre: 'Cancha 2' },
      { id: 'c3', nombre: 'Cancha 3' },
    ],
  },
  {
    id: 'boleita',
    nombre: 'Boleíta',
    canchas: [
      { id: 'c1', nombre: 'Cancha 1' },
      { id: 'c2', nombre: 'Cancha 2' },
    ],
  },
  {
    id: 'santa-rosa',
    nombre: 'Santa Rosa',
    canchas: [
      { id: 'c1', nombre: 'Cancha 1' },
      { id: 'c2', nombre: 'Cancha 2' },
    ],
  },
  {
    id: 'capital',
    nombre: 'Capital',
    canchas: [
      { id: 'c1', nombre: 'Cancha 1' },
      { id: 'c2', nombre: 'Cancha 2' },
    ],
  },
]

const CLASES_BASE = [
  {
    cancha: 0,
    horaInicio: '08:00',
    horaFin: '09:30',
    profesorNombre: 'Pablo Profesor',
    alumnoNombres: ['Aldo Adulto', 'Marta Menor', 'Luis López'],
    estado: 'ejecutada',
  },
  {
    cancha: 0,
    horaInicio: '09:30',
    horaFin: '10:30',
    profesorNombre: 'Pablo Profesor',
    alumnoNombres: ['Aldo Adulto', 'Sofía Sánchez'],
    estado: 'pendiente_cobro',
  },
  {
    cancha: 0,
    horaInicio: '08:00',
    horaFin: '09:00',
    profesorNombre: 'Paola Profesora',
    alumnoNombres: ['Marta Menor'],
    estado: 'cancelada',
  },
  {
    cancha: 1,
    horaInicio: '10:00',
    horaFin: '11:30',
    profesorNombre: 'Paola Profesora',
    alumnoNombres: ['Aldo Adulto', 'Luis López', 'Sofía Sánchez', 'Marta Menor'],
    estado: 'reservada',
  },
  {
    cancha: 1,
    horaInicio: '16:00',
    horaFin: '17:00',
    profesorNombre: 'Pablo Profesor',
    alumnoNombres: ['Luis López'],
    estado: 'cobrada',
  },
  {
    cancha: 2,
    horaInicio: '18:00',
    horaFin: '19:30',
    profesorNombre: 'Pablo Profesor',
    alumnoNombres: ['Aldo Adulto', 'Marta Menor'],
    estado: 'reservada',
  },
  {
    cancha: 2,
    horaInicio: '19:30',
    horaFin: '20:30',
    profesorNombre: 'Paola Profesora',
    alumnoNombres: ['Sofía Sánchez', 'Luis López'],
    estado: 'ejecutada',
  },
]

export function clasesDeMuestra(sede, fecha) {
  return CLASES_BASE.filter((item) => item.cancha < sede.canchas.length).map((item, i) => {
    const cancha = sede.canchas[item.cancha]
    return {
      id: `${sede.id}-${cancha.id}-${item.horaInicio}-${i}`,
      sedeId: sede.id,
      sedeNombre: sede.nombre,
      canchaId: cancha.id,
      fecha,
      horaInicio: item.horaInicio,
      horaFin: item.horaFin,
      tipo: i % 2 === 0 ? 'variable' : 'fija',
      cupo: 4,
      alumnos: [],
      alumnoNombres: item.alumnoNombres,
      profesorId: item.profesorNombre === 'Pablo Profesor' ? 'p1' : 'p2',
      profesorNombre: item.profesorNombre,
      estado: item.estado,
      asistencias: [],
    }
  })
}
