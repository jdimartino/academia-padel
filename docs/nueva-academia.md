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
- `.env.example` → `VITE_TENANT_ID=tienda-ejemplo`.
- No copies `.env.local` del demo. Crea el tuyo desde `.env.example`.

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
npm run build --workspace=@academia/site-tienda-ejemplo
```

Con `VITE_USE_EMULATORS=true` el build guard no se activa y el build pasa. Para un build
real, `VITE_USE_EMULATORS=false` activa el guard: exige `VITE_FIREBASE_PROJECT_ID` igual a
`academia-padel-jdm`, `VITE_TENANT_ID` igual al de la academia y una API key no vacía. El
guard no imprime valores; solo dice qué variable falla.

## 5. Orden del primer despliegue (pendiente: cloud project not created yet)

1. Crear el sitio y aplicar el target (paso 2).
2. Revisar reglas (paso 3).
3. Build real (paso 4) con `.env.local` completo.
4. Deploy solo de hosting del sitio, a través del workspace `jdm`:

```bash
npm run deploy academia-padel:tienda-ejemplo
```

Nunca `firebase deploy` directo desde la carpeta (AGENTS.md).

## 6. Copia de seguridad antes de tocar producción (pendiente: decisión del dueño)

Antes de cualquier cambio en una academia real (reglas, despliegue, migración) hace falta
una exportación de Firestore. **Conflicto a resolver:** AGENTS.md prohíbe backups por costo
(Cloud Storage), y el `gcloud firestore export` de POS necesita un bucket. Hasta que el
dueño decida, no ejecutes ninguna exportación en la nube. Si se aprueba, anota la fecha y el
resultado en la carpeta de backups del workspace.

## Lista de comprobación

- [ ] Tenant id en minúsculas, solo `a-z`, `0-9` y `-`.
- [ ] Carpeta creada desde `sites/demo` y `package.json` renombrado.
- [ ] `vite.config.js` con `EXPECTED_TENANT_ID` de la academia.
- [ ] `.env.local` propio, sin copiar el del demo. Nunca se commitea.
- [ ] `npm run build` pasa en emulador y el guard rechaza valores incorrectos.
- [ ] Sitio y target creados (pendiente: cloud project not created yet).
- [ ] Entrada en `../jdm/config/projects.json` agregada (pendiente).
- [ ] Copia de seguridad aprobada por el dueño antes de producción (pendiente).
