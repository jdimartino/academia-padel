# Fase 0 — Investigación y decisiones de base

Fecha de investigación: **2026-10-02**. Todos los límites se verificaron en la
documentación oficial de Firebase (ver *Fuentes* al final). Los precios/ límites
cambian: reverificar antes de cada decisión de diseño grande.

> Alcance de esta fase: investigación, modelo de datos y esqueleto local.
> No se tocó ningún proyecto de la nube. No se ejecutó `firebase login`,
> `firebase deploy` ni nada que consuma cuota real. Todo lo local se probó con
> el **Emulator Suite**.

---

## 1. Resumen ejecutivo

| Producto | Qué da el plan sin costo | Alcanza para el SaaS |
| --- | --- | --- |
| Cloud Firestore (Standard) | 1 GiB, **50.000 lecturas/día**, **20.000 escrituras/día**, 20.000 borrados/día, 10 GiB/mes de egress | Sí, si las consultas van acotadas y cacheadas. |
| Authentication | 50.000 MAU sin costo (email/password) | Sí, de sobra. |
| Hosting | 10 GB almacenados, **360 MB/día** de transferencia | Sí para tráfico bajo; es el límite más frágil. |
| Cloud Storage | 5 GB / cuota diaria, **pero deshabilitado por AGENTS.md** | No por ahora (ver §5). |
| Cloud Functions | **Solo en Blaze** (2M invocaciones/mes, etc.), **deshabilitado por AGENTS.md** | No por ahora (ver §5). |

Conclusión: el recurso que manda es la **cuota diaria de lecturas/escrituras de
Firestore** y el **ancho de banda diario de Hosting**. Todo el modelo de datos
y las consultas se diseñan para gastar pocas lecturas.

---

## 2. Límites verificados

### 2.1 Cloud Firestore (edición Standard)

Cuota sin costo, **por proyecto** (no por app), con reinicio diario a medianoche
y egress mensual:

- 1 GiB de almacenamiento total.
- 50.000 lecturas de documento/día.
- 20.000 escrituras de documento/día.
- 20.000 borrados de documento/día.
- 10 GiB/mes de salida de red.

Puntos de costo que importan aunque la cuota sea alta:

- **Las lecturas hechas desde las Security Rules (`get()` / `exists()`) se
  facturan y cuentan como lecturas.** Un rule que hace `get()` del documento de
  membresía en cada operación suma lecturas silenciosas. Hay que mantenerlo.
- Una consulta `getDocs` cobra **1 lectura por documento devuelto**, aunque no
  lo uses. `limit()` y paginación son obligatorios.
- `onSnapshot` cobra un read inicial por documento + un read por cada cambio.
  Se usa solo donde de verdad se necesita tiempo real.
- El tamaño máximo de un documento es 1 MiB y el ritmo de escritura sostenido es
  ~1 escritura/segundo por documento. *Verificar el resto de límites duros
  (índices compuestos, entradas por campo) en la página oficial antes de
  llevarlos a producción.*

### 2.2 Authentication

- Email/password: sin costo hasta **50.000 MAU**. No usamos Phone Auth (se
  factura por SMS y queda fuera de la restricción).

### 2.3 Hosting

- 10 GB de almacenamiento, **360 MB/día** de transferencia.
- El límite diario de 360 MB es el más chico del proyecto: un sitio React
  pesado con muchos assets estáticos lo puede rozar con poco tráfico. Mitigar:
  build cacheable (ya configurado en `firebase.json` con `max-age` largo),
  code-splitting por módulo y evitar imágenes pesadas en el repo.

### 2.4 Cloud Storage y Cloud Functions (no habilitados)

- Storage sin costo: 5 GB y cuotas diarias según bucket (`*.appspot.com` o
  `*.firebasestorage.app`).
- Functions solo existe a partir del plan Blaze, con cuota sin costo mensual de
  2M invocaciones / 400K GB-s / 200K CPU-s / 5 GB de egress.
- **AGENTS.md prohíbe habilitar ambos por ahora.** Se documentan como
  referencia y como pregunta abierta (§5).

---

## 3. Spark vs Blaze

Hay una tensión entre documentos del proyecto:

- El pedido de Fase 0 dice: "todo tiene que correr dentro del free tier" y que
  el proyecto cloud **todavía no existe**.
- `AGENTS.md` dice que el proyecto corre en **Blaze** con la regla de quedarse
  dentro de la cuota gratuita, y que **solo la base `(default)`** califica.

Lo único que hay que decidir antes de crear el proyecto cloud:

1. Si se crea en **Spark**, se obtiene la cuota gratuita de Firestore/Auth/
   Hosting sin tarjeta, pero las Cloud Functions no se pueden desplegar.
2. Si se crea en **Blaze**, se pueden desplegar Functions (por ejemplo el correo
   de Brevo de `tenistac-amistosos`, reutilizable "más adelante"), pero exige
   método de pago y **alertas de presupuesto** para no pasarse de la cuota.

Por ahora (fase 0) no importa: **no se crea el proyecto**. Se recomienda
empezar en Spark y decidir Blaze recién cuando se necesiten Functions.

---

## 4. Patrones multi-tenant que minimizan lecturas

Diseño elegido (detalle completo en `docs/modelo-datos.md`):

1. **Todo cuelga de `academias/{tenantId}/...`** (subcolecciones). Ventajas:
   - Las reglas valen por subárbol y el aislamiento por tenant es natural.
   - Las consultas se acotan sin necesidad de `where('tenantId','==',...)`.
   - No hay que filtrar por tenant a mano en cada query.
2. **Descubrimiento de tenants por *collection group*:** el usuario pertenece a
   `academias/{tenantId}/miembros/{uid}`; al iniciar sesión se consulta
   `collectionGroup('miembros').where('uid','==',uid)`. Es **una** consulta
   acotada que devuelve todas las academias del usuario, sin colecciones
   top-level extra.
3. **Denormalizar lo que se lee siempre:** guardar `sedeNombre`, `profesorNombre`,
   `alumnoNombre` dentro de `clases`/`cargos` para no hacer lecturas de lookup.
   El costo es tener que actualizar el nombre en más de un lugar (se acepta).
4. **Asistencia embebida en la clase** (array `asistencias`), no subcolección:
   leer la clase ya trae la asistencia, sin N lecturas extra. Una clase tiene
   pocos alumnos, así que el documento nunca se acerca a 1 MiB.
5. **Nada de `getDocs` sin `where`.** Toda consulta por sede/fecha/estado y con
   `limit()`.
6. **Nada de `onSnapshot` por defecto.** Solo pantallas que lo justifiquen
   (p. ej. recepción el mismo día), con los mismos límites.
7. **Índices compuestos** declarados en `firestore.indexes.json` antes de
   publicar cada consulta (un índice faltante no cobra, pero rompe la query).
8. **Agregaciones** (`count()`, `sum()`, `average()`) donde se pueda, en vez de
   traer la colección para contar en el cliente.

Los *rules* que usan `get()` de la membresía cuestan ~1 lectura por operación.
Es aceptable con 50K/día para el tamaño esperado, pero se puede eliminar más
adelante usando **custom claims** en el token (requiere Functions o Admin SDK;
queda como pregunta abierta, §5).

---

## 5. Hallazgos del Emulator Suite (verificados localmente)

Probado en esta máquina con `firebase-tools 15.32.1` y Java 27, sin login y sin
tocar la nube. Resultados:

1. El emulador arranca sin sesión de Firebase y sin proyecto cloud:
   `firebase emulators:start --only auth,firestore`.
2. **Las Security Rules se aplican de verdad en el emulador.** Un write sin
   autenticar devuelve `403 PERMISSION_DENIED`. Esto permite probar el modelo
   de permisos antes de tener proyecto.
3. **Existe un bypass de administrador para el seeding:** cualquier request
   REST a Firestore con header `Authorization: Bearer owner` saltea las reglas.
   Esto permite escribir el tenant de ensayo **sin `firebase-admin`** (no se
   agregó ninguna dependencia) y sin reglas permisivas temporales.
4. **El emulador de Auth expone una API de administración** que también acepta
   `Authorization: Bearer owner`:
   `POST /identitytoolkit.googleapis.com/v1/projects/{projectId}/accounts`
   crea un usuario (devuelve `localId`). Los usuarios creados pueden iniciar
   sesión con el protocolo de cliente (`accounts:signInWithPassword`), que es
   exactamente lo que usa el SDK web con `connectAuthEmulator`.
5. La base `(default)` se usa tal cual; no hace falta base con nombre.

Con esto, el `scripts/seed.mjs` usa **solo `fetch` nativo de Node**: sin
dependencias nuevas, consistente con AGENTS.md.

---

## 6. Preguntas abiertas

Estas no se resuelven en Fase 0 y no deben inventarse:

1. **Estructura de sedes:** ¿las 4 sedes (Traki, Boleíta, Santa Rosa, Capital)
   son del primer tenant o son un catálogo global compartido? Se asumió que
   **cada tenant define sus propias sedes**. Confirmar.
2. **Monorepo vs single app:** ¿una sola app React que resuelve el tenant por
   subdominio/path, o un repo por academia? Se asumió **single app multi-tenant**.
3. **Estrategia de deploy:** ¿un solo sitio de Hosting (`academia-padel-jdm`) con
   tenants por subdominio, o un sitio por academia? Afecta cuotas de Hosting y
   certificados.
4. **Cloud Functions:** el pedido menciona Functions v2 + Brevo "más adelante",
   pero AGENTS.md lo prohíbe por ahora. ¿Se habilita Blaze cuando toque el
   correo?
5. **Cloud Storage / comprobantes de pago:** el flujo pide "subir comprobante",
   pero Storage está prohibido. Opciones a decidir: (a) habilitar Storage;
   (b) guardar solo una URL externa; (c) guardar el comprobante como base64 en
   Firestore (desaconsejado: 1 MiB y lecturas). **Sin definir.**
6. **Roles exactos:** ¿"Administrador" y "recepción" son el mismo rol o dos?
   Se modeló `administrador` como quien puede crear reservas. **Sin definir.**
7. **Custom claims vs `get()` en reglas:** ¿se acepta el costo de lecturas de
   las reglas o se pasa a custom claims (requiere Functions/Admin SDK)?
8. **Entorno de test:** ¿se agrega `@firebase/rules-unit-testing` para tests de
   reglas automatizados? Es una dependencia nueva; requiere aprobación.
9. **Provisioning de usuarios sin Functions:** en producción, ¿cómo crea la
   academia cuentas de alumnos/profesores y les asigna rol? Con Functions sería
   trivial; sin ellas hay que usar Admin SDK local o el truco de app secundaria.
   **Sin definir.**

---

## 7. Riesgos detectados

- **Hosting 360 MB/día** es el límite más fácil de romper con assets pesados.
- **Lecturas de las reglas** (`get()` de membresía) suman al cupo diario.
- **Sin Functions no hay backend confiable** para provisioning ni para correos;
  toda la lógica de escritura queda en el cliente y debe protegerse solo con
  reglas.
- **Sin Storage** el flujo de comprobantes de pago queda bloqueado hasta decidir.

---

## 8. Fuentes

- Firebase Pricing (cuotas Spark/Blaze por producto):
  <https://firebase.google.com/pricing>
- Firestore — Usage and limits:
  <https://firebase.google.com/docs/firestore/quotas>
- Firestore — Securely query data (patrón de reglas para queries):
  <https://firebase.google.com/docs/firestore/security/rules-query>
- Firestore — Role-based access solution:
  <https://firebase.google.com/docs/firestore/solutions/role-based-access>
- Emulator Suite — Firestore / Auth:
  <https://firebase.google.com/docs/emulator-suite/connect_firestore>
  <https://firebase.google.com/docs/emulator-suite/connect_auth>
- Firestore REST API:
  <https://firebase.google.com/docs/firestore/use-rest-api>
- Repos de referencia (solo lectura):
  <https://github.com/jdimartino/profesores-prueba>
  <https://github.com/jdimartino/tenistac-amistosos>
