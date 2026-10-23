# Nueva academia (sitio por academia)

> **Pendiente: el proyecto de Firebase en la nube todavía no existe.** Todos los pasos
> de nube (crear sitio de hosting, aplicar target, reglas desplegadas, deploy) están
> marcados como **pendiente** y no se han ejecutado. Los pasos de carpeta y de build sí
> se pueden hacer hoy contra el emulador.

Proyecto: `academia-padel-jdm` (permanente, región `us-east1`).
Ejemplo usado abajo: academia `tienda-ejemplo` (tenant `tienda-ejemplo`, sitio
`academia-padel-tienda-ejemplo`). Reemplaza `tienda-ejemplo` en todos los comandos.

Regla de costo (AGENTS.md): solo la base `(default)` de Firestore. Sin Functions, sin
Storage, sin backups/PITR/TTL sin instrucción explícita del dueño.

## 1. Crear la carpeta del sitio

```bash
cd ~/Desktop/Antigravity/academia-padel/sites
rsync -a --exclude dist --exclude node_modules --exclude .firebase --exclude .env.local demo/ tienda-ejemplo/
```

Cambia en `sites/tienda-ejemplo/`:

- `package.json` → `"name": "@academia/site-tienda-ejemplo"`.
- `.firebaserc` → target `demo` por `tienda-ejemplo` y sitio `academia-padel-demo` por
  `academia-padel-tienda-ejemplo`.
- `firebase.json` → `"target": "tienda-ejemplo"`.
- `vite.config.js` → `EXPECTED_TENANT_ID = 'tienda-ejemplo'`. `EXPECTED_PROJECT_ID` se queda en
  `academia-padel-jdm`.
- `src/main.jsx` → `config` (`academyName`, `tagline`, `logoUrl`) y `toggles` propios de la
  academia. Los toggles activan funciones solo para esta academia.
- `index.html` → título. `public/` → favicon propio si lo tiene.
- `.env.example` y `.env.emulator` → `VITE_TENANT_ID=tienda-ejemplo`.
- No copies `.env.local` ni `.env.production.local` del demo. Crea los tuyos desde `.env.example`.

Si la academia necesita una función que el núcleo todavía no tiene, agrégala en
`packages/academia-core` detrás de un toggle que solo esta academia active. No dupliques
el núcleo dentro de `sites/`.

Después de copiar, corre `npm install` en la raíz (enlaza el workspace nuevo) y verifica
el nombre del paquete con `npm ls --workspaces`.

## 2. Crear el sitio de hosting y el target (pendiente: cloud project not created yet)

```bash
firebase hosting:sites:create academia-padel-tienda-ejemplo --project academia-padel-jdm
cd ~/Desktop/Antigravity/academia-padel/sites/tienda-ejemplo
firebase target:apply hosting tienda-ejemplo academia-padel-tienda-ejemplo --project academia-padel-jdm
```

Para que `npm run deploy academia-padel:tienda-ejemplo` funcione desde el workspace `jdm`,
agrega el target en `../jdm/config/projects.json` (`hostingTargets`) siguiendo el formato
del proyecto demo. Cambia solo ese archivo del workspace `jdm`.

## 3. Reglas

Las reglas viven en la raíz (`firestore.rules`) y son por tenant y rol. Antes de que la
academia nueva use la nube, revisa que sus datos estén bajo `academias/tienda-ejemplo/...`.
Despliega reglas solo cuando el dueño lo apruebe (pendiente: cloud project not created yet).

## 4. Build y verificación local

```bash
cd ~/Desktop/Antigravity/academia-padel
npm run build:emulator --workspace=@academia/site-tienda-ejemplo   # local, contra emuladores
npm run build --workspace=@academia/site-tienda-ejemplo            # producción (guard)
```

`build:emulator` usa `--mode emulator` (lee `.env.emulator`, `VITE_USE_EMULATORS=true`).
Cualquier otro build es de producción y el guard lo revisa SIEMPRE: exige
`VITE_USE_EMULATORS=false`, `VITE_FIREBASE_PROJECT_ID` igual a `academia-padel-jdm`,
`VITE_TENANT_ID` igual al de la academia y una API key no vacía. Es el mismo `npm run build`
que corre `jdm` dentro de la carpeta del sitio al deployar. Los valores de producción van en
`.env.production.local` (gitignorado). El guard no imprime valores; solo dice qué falla.

## 5. Orden del primer despliegue (pendiente: cloud project not created yet)

1. Crear el sitio y aplicar el target (paso 2).
2. Revisar reglas (paso 3).
3. Build de producción (paso 4) con `.env.production.local` completo y `VITE_USE_EMULATORS=false`.
4. Deploy solo de hosting del sitio, a través del workspace `jdm`:

```bash
npm run deploy academia-padel:tienda-ejemplo
```

Nunca `firebase deploy` directo desde la carpeta (AGENTS.md).

## 6. Copia de seguridad antes de tocar producción (pendiente: cloud project not created yet)

Antes de cualquier cambio en una academia real (reglas, despliegue, migración) corre el
respaldo del workspace `jdm`. **No uses `gcloud firestore export`**: necesita un bucket de
Cloud Storage y AGENTS.md lo prohíbe (regla de costo). El flujo de `jdm` no usa Storage:
lee Firestore con `firebase-admin` y sube JSON a un repo privado de GitHub.

Cómo funciona (leído de `jdm/package.json`, `jdm/scripts/BackupGlobal.sh` y
`jdm/.github/workflows/backup.yml`, sin modificarlos):

- Respaldo automático semanal con GitHub Actions (lunes 13:00 UTC), a `jdimartino/jdm-backups`.
- Respaldo manual o de emergencia, desde la carpeta de `jdm`:

    cd ~/Desktop/Antigravity/jdm
    npm run backup

  Recorre los proyectos de `config/projects.json` con `hasFirestore` y sin `inactive`,
  exporta cada uno, sube una carpeta con fecha al repo de respaldos, conserva los últimos
  10 y avisa por Telegram. Necesita `config/backup.env` (`GH_TOKEN`, Telegram) y credenciales
  de `firebase-admin`; nunca los pegues en este repo.
- Modo de respaldo: la entrada `academia-padel` de `projects.json` no define `backupMode`,
  así que usa el modo por defecto `project` (`firestore-export.js`, exporta todo el
  proyecto `academia-padel-jdm`). **No pongas `backupMode: "tenants"`**: ese exportador
  solo descubre tenants bajo la colección raíz `tenants/` (pos-monorepo) y esta app guarda
  los datos bajo `academias/{tenantId}`; fallaría por "ningún tenant".
- Antes de reglas, deploy o migración: corre `npm run backup`, revisa que termine con
  "RESPALDO COMPLETADO" y que la academia aparezca en "Respaldados", y recién entonces sigue.
  Anota la fecha del respaldo en tu bitácora.
- Las exportaciones del emulador (`firebase-export-*`, `.emulator-data`) son datos de
  desarrollo: no son respaldos y no se commitean.

## 7. Demo en la nube

La academia de vitrina vive en el tenant `demo` del proyecto `academia-padel-jdm`
(https://academia-padel-demo.web.app). Sus datos son los MISMOS del seed del
emulador: los arma el constructor puro `scripts/seed-data.mjs` y los escribe el
script del workspace `jdm/scripts/academia-seed-demo.js` (firebase-admin). Solo
escribe bajo `academias/demo/**` y solo crea/borra sus propios usuarios de Auth
(uids `demo-admin` y `demo-profe`); el projectId de la clave debe ser
`academia-padel-jdm` o aborta.

Refrescar la demo, desde la carpeta de `jdm`:

    cd ~/Desktop/Antigravity/jdm
    node scripts/academia-seed-demo.js                     # DRY-RUN: conteos por colección y usuarios, no escribe
    node scripts/academia-seed-demo.js --confirm           # escribe (upsert de docs y usuarios del seed)
    node scripts/academia-seed-demo.js --confirm --reset   # borra academias/demo/** y los usuarios del seed, y siembra de nuevo

Usá `--reset` cuando la demo quedó "sucia" (clases o fichas creadas por quien la
probó); sin `--reset` solo se reescriben los documentos del seed. Las fechas son
relativas al día en que se corre, así que conviene refrescarla antes de mostrarla.

- Clave de servicio: `jdm/config/academia-padel-jdm-serviceAccount.json`
  (gitignored, `chmod 600`). Nunca se copia a este repo ni se imprime.
- Logins de la demo (credenciales públicas de vitrina, la contraseña la tiene el
  dueño del proyecto y sale en el reporte del seed):
  - `admin@demo.academia-padel.app`: administrador ("Admin Demo")
  - `profe@demo.academia-padel.app`: profesor (solo su asistencia)

Para una academia real NO se usa este script: es solo para el tenant `demo`
(el tenant está fijo en el código).

## Lista de comprobación

- [ ] Tenant id en minúsculas, solo `a-z`, `0-9` y `-`.
- [ ] Carpeta creada desde `sites/demo` y `package.json` renombrado.
- [ ] `vite.config.js` con `EXPECTED_TENANT_ID` de la academia.
- [ ] `.env.local` propio, sin copiar el del demo. Nunca se commitea.
- [ ] `build:emulator` pasa y el `build` de producción rechaza valores incorrectos (incluido `VITE_USE_EMULATORS=true`).
- [ ] Sitio y target creados (pendiente: cloud project not created yet).
- [ ] Entrada en `../jdm/config/projects.json` agregada (pendiente).
- [ ] `npm run backup` (en `jdm`) terminado con éxito antes de tocar producción (pendiente).
