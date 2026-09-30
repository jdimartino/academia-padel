# Academia Pádel

SaaS multi-tenant para academias de pádel: sedes, canchas, profesores, clases,
asistencia, facturación y liquidación de honorarios de profesores.

Se vende como suscripción mensual **por academia** (cada academia es un tenant).

## Stack

- React 19 + Vite (JavaScript, sin TypeScript)
- React Router
- Firebase (Authentication + Cloud Firestore + Hosting)
- CSS propio, mobile-first. Sin librerías de UI.

## Cómo correrlo

```bash
npm install
cp .env.example .env.local   # completar los valores
dev academia-padel
```

`dev` es el alias del workspace que levanta el servidor de Vite en
`~/Desktop/Antigravity/academia-padel`.

Build de producción:

```bash
npm run build
```

## Firebase

- Project ID: `academia-padel-jdm`
- Hosting: `academia-padel-jdm.web.app`
- Firestore: base `(default)` en `us-east1`

## Regla de costo (no negociable)

El proyecto usa el plan **Blaze**, pero todo tiene que quedar dentro de la
cuota gratuita:

- Solo la base de datos `(default)` de Firestore califica para la cuota gratis.
  **Nunca crear una base con nombre.**
- No habilitar nada pago: nada de Cloud Functions, Storage, backups, PITR ni TTL
  hasta que se pida explícitamente.
- Las consultas a Firestore van siempre acotadas (tenant, sede, rango de fechas,
  límite/paginación) para no generar lecturas de más.

## Regla de UI

Todas las pantallas, ahora y en el futuro, tienen que ser responsivas: primero
mobile, después desktop. Nada de anchos fijos ni de layouts que solo funcionen
en un tamaño.
