# Academia Pádel

SaaS multi-tenant para academias de pádel: sedes, canchas, profesores, clases,
asistencia, facturación y liquidación de honorarios de profesores.

Se vende como suscripción mensual **por academia** (cada academia es un tenant).

## Stack

- React 19 + Vite (JavaScript, sin TypeScript)
- React Router
- Firebase (Authentication + Cloud Firestore + Hosting)
- CSS propio, mobile-first. Sin librerías de UI.

## Requisitos

- Node 20+ y npm
- Firebase CLI (`npm i -g firebase-tools`)
- Java 11+ (lo necesita el emulador de Firestore)

## Cómo correrlo (Fase 0, todo local)

No hay proyecto de Firebase en la nube todavía. Todo corre contra el
**Emulator Suite**.

```bash
npm install
cp .env.example .env.local
```

En **una terminal** levantá los emuladores (Auth + Firestore + Hosting + UI):

```bash
npm run emulators
```

En **otra terminal** sembrá el tenant de ensayo:

```bash
npm run seed
```

En una **tercera terminal** corré la app:

```bash
npm run dev
```

Abrí http://localhost:5173 y entrá con el usuario de ensayo (contraseña
`ensayo1234`):

| Correo | Rol | Acceso |
| --- | --- | --- |
| `admin@ensayo.test` | Administrador | Sí, opera toda la academia |
| `profe@ensayo.test` | Profesor | **No** (ficha; usuario negativo de test) |
| `alumno@ensayo.test` | Alumno adulto | **No** (ficha; usuario negativo de test) |
| `representante@ensayo.test` | Alumno menor (representante) | **No** (ficha; usuario negativo de test) |

Por ahora **solo el administrador inicia sesión y opera**. Profesor, alumno y
representante son fichas del modelo, no cuentas: si entran, la app muestra "Esta cuenta
no tiene acceso a esta academia". Se conservan para probar los DENY.

Emulator UI: http://127.0.0.1:4000

### Atajo: sembrar sin dejar los emuladores levantados

```bash
npm run seed:emu
```

Levanta los emuladores, corre el seed y los apaga. Útil en CI o para resetear.

### Alumnos extra para probar la paginación

El seed deja **15 alumnos** de ensayo (apellidos con tildes y con ñ, adultos y
menores, y 3 inactivos). Para ejercitar el listado paginado de la pantalla de
Alumnos se pueden sembrar fichas extra deterministas:

```bash
SEED_ALUMNOS_EXTRA=150 npm run seed:emu
```

`SEED_ALUMNOS_EXTRA=N` agrega N alumnos ficticios más (ids `extra-0001`…) sin
`Math.random()`: la misma N produce siempre las mismas fichas. Con N=150 el
listado arranca con 100 y aparece "Cargar mas". Sin la variable, el seed
escribe solo los 15 de base.

### Tests de reglas

```bash
npm run test:rules
```

Levanta **solo** el emulador de Firestore, carga `firestore.rules` y corre
`tests/rules.test.js` (runner nativo de Node, sin dependencias extra). Cada test
declara el rol que actúa y si espera ALLOW o DENY. No toca la nube.

### Tests de la reserva

```bash
npm run test:db      # o: npm test (corre los dos)
```

`tests/db.test.js` corre el mismo `src/firebase/db.js` que usa la app contra el
emulador: horario libre, solapamiento exacto y parcial, horarios adyacentes,
cancelación que libera los bloques y dos reservas simultáneas del mismo slot
(gana una sola).

### Build de producción

```bash
npm run build
```

Antes de un build real, poner `VITE_USE_EMULATORS=false` en `.env.local` (o
definir las variables en el entorno de deploy).

## Estructura

```
src/
  firebase/     config.js (init + emuladores) y db.js (ÚNICA capa de datos)
  context/      AuthContext.jsx
  pages/        Login, Home, Agenda
  components/   ProtectedRoute
scripts/
  seed.mjs      tenant de ensayo por REST contra el emulador
docs/
  fase-0.md         investigación de límites y decisiones
  modelo-datos.md   modelo de Firestore propuesto
firestore.rules       reglas por tenant + rol
firestore.indexes.json
```

## Arquitectura multi-tenant

- Todos los datos cuelgan de `academias/{tenantId}/...`.
- Cada usuario pertenece a un tenant vía `academias/{tenantId}/miembros/{uid}`
  con un `rol`. **Hoy el único rol con acceso es `administrador`.**
- Al iniciar sesión, el cliente descubre sus academias con una sola consulta
  `collectionGroup('miembros').where('uid','==',uid)`.
- Las Security Rules exigen `administrador` activo en cada operación; el resto
  queda en DENY salvo la lectura de la propia membresía. El default es deny.
- La reserva no se solapa gracias a `academias/{tenantId}/bloques/{bloqueId}`:
  un documento por bloque de 30 minutos de cancha (y otro del profesor), con ID
  determinista, escritos en la misma transacción que la clase.

Ver `docs/modelo-datos.md` para el detalle.

## Regla de costo (no negociable)

El proyecto apunta al plan sin costo de Firebase. Todo tiene que quedar dentro
de la cuota gratuita:

- Solo la base de datos `(default)` de Firestore califica. **Nunca crear una
  base con nombre.**
- **No** habilitar Cloud Functions, Cloud Storage, backups, PITR ni TTL.
- Las consultas a Firestore van siempre acotadas (tenant, sede, rango de fechas,
  límite/paginación). Nada de `getDocs` sin `where`.

Detalle y números en `docs/fase-0.md`.

## Regla de UI

Todas las pantallas, ahora y en el futuro, tienen que ser responsivas: primero
mobile, después desktop. Nada de anchos fijos ni de layouts que solo funcionen
en un tamaño.

## Firebase

- Project ID: `academia-padel-jdm` (todavía **no creado** en la nube)
- Hosting: `academia-padel-jdm.web.app`
- Firestore: base `(default)`, región `us-east1`
- Deploys: a través del tooling del workspace (`jdm`), nunca `firebase deploy`
  desde esta carpeta.
