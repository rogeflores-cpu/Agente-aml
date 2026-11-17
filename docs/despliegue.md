# Despliegue en producción — Agente AML

Dueño del producto: **AML Consulting Guatemala** · dominio `amlconsultingguatemala.com`.
Última actualización: 17-nov-2026.

## Mapa

| Dirección | Qué es | Dónde corre |
|---|---|---|
| `https://api.amlconsultingguatemala.com` | Servidor (`apps/flujos`): API, webhook de WhatsApp, flujos de Inngest | Render, servicio `aml-api` (siempre encendido) |
| `https://consola.amlconsultingguatemala.com` | Consola de cumplimiento y vista operativa | Render, sitio estático `aml-consola` |
| `https://plataforma.amlconsultingguatemala.com` | Administración de la plataforma | Render, sitio estático `aml-plataforma` |
| `https://<organización>.clientes.amlconsultingguatemala.com` | Portal del cliente con la marca de cada inmobiliaria | Render, sitio estático `aml-portal` (subdominio comodín) |
| Supabase (`<ref>.supabase.co`) | Base de datos, usuarios, documentos y Vault | Supabase, región East US (N. Virginia) |
| Inngest Cloud | Flujos programados y con reintentos | Inngest |

Todo queda en la región este de EE. UU., la más cercana a Guatemala.

**Por qué Render y no Netlify:** el portal necesita un subdominio por inmobiliaria (`*.clientes…`) y el
servidor necesita estar encendido siempre para recibir los mensajes de WhatsApp. Además, el plan
gratuito de Netlify ya lo usa el sitio de FSC y sus créditos se agotarían.

**Costo aproximado de arranque** (precios de referencia, confirmarlos al contratar):
Render Starter para la API ≈ USD 7/mes (los sitios estáticos no tienen costo); Supabase Pro
≈ USD 25/mes por organización; Inngest y Anthropic según uso (Inngest tiene un nivel gratuito; a
Anthropic conviene ponerle un límite mensual).

---

## Orden recomendado

Cada paso dice **quién** lo hace. Los marcados *(usted)* necesitan su cuenta o su tarjeta; el resto lo
puedo hacer yo cuando me pase los datos indicados (nunca pegue llaves en el chat: se configuran
directamente en cada servicio).

### 1. Supabase *(usted crea; yo aplico y verifico)*

1. En supabase.com, cree una **organización nueva** a nombre de AML Consulting Guatemala (separada de
   la de FSC: así la facturación y la propiedad quedan claras) y elija el plan Pro.
2. **New project**: nombre `agente-aml`, región **East US (North Virginia)**, contraseña de base de datos
   larga (guárdela en su gestor de contraseñas).
3. Aplique las migraciones desde una computadora con el repositorio:

   ```bash
   npx supabase init
   ```

   ```bash
   npx supabase link --project-ref <ref-del-proyecto>
   ```

   ```bash
   npx supabase db push
   ```

   `db push` aplica en orden los 16 archivos de `supabase/migrations` y lleva el registro de cuáles ya
   se aplicaron. No ejecute `supabase/tests/00_stub_supabase.sql` en el proyecto real: es solo para
   pruebas locales.
4. **Settings → API → Exposed schemas**: agregue `aml`.
5. **Authentication → Sign In / Providers**: desactive *Allow new users to sign up* (los usuarios solo
   entran por invitación). **URL Configuration**: *Site URL* = `https://consola.amlconsultingguatemala.com`;
   en *Redirect URLs* agregue también `https://plataforma.amlconsultingguatemala.com`.
6. **Authentication → Emails → SMTP**: configure un remitente propio (por ejemplo
   `no-responder@amlconsultingguatemala.com` con Resend u otro proveedor). El correo de prueba de
   Supabase tiene un límite muy bajo por hora y las invitaciones dejarían de llegar.
7. **Storage**: confirme que el bucket `expedientes` existe y **no es público**.
8. **Database → Extensions**: confirme que **Vault** (`supabase_vault`) está activa (guarda el token de
   WhatsApp de cada inmobiliaria).
9. Copie de **Settings → API**: la URL del proyecto, la llave pública (`anon`) y la llave de servicio
   (`service_role`). La de servicio solo va en Render, en el servicio `aml-api`.

### 2. Anthropic *(usted)*

1. En console.anthropic.com, cree una organización a nombre de la empresa y una **API key** llamada
   `agente-aml-produccion`.
2. En *Limits*, fije un límite de gasto mensual. Para el piloto, un monto bajo es suficiente; se ajusta
   con el uso real.

### 3. Inngest *(usted crea la cuenta; yo conecto)*

1. En inngest.com, cree la cuenta y el entorno **Production**.
2. Copie la **Event Key** y la **Signing Key**.
3. Después del paso 5, en *Apps → Sync new app*, indique
   `https://api.amlconsultingguatemala.com/api/inngest`. Deben aparecer **11 funciones** (bienvenida,
   cotejos ONU y 1373, lista ONU diaria, plazos del art. 43, verificación diferida, actualización
   periódica, WhatsApp entrante, revisión GAFI y ancla de la bitácora).
4. Ejecute una vez a mano la función `lista-onu-diaria` (*Invoke*) para cargar la lista de la ONU antes
   del primer expediente; después corre sola todos los días a las 5:00.

### 4. Repositorio

Render despliega desde la rama `main` de `rogeflores-cpu/agente-aml`. Antes de crear los servicios hay
que fusionar la rama de trabajo (`claude/exciting-newton-25fiy2`) en `main` con un pull request.

### 5. Render *(usted crea la cuenta; luego seguimos juntos)*

1. En render.com, cree la cuenta del equipo **AML Consulting Guatemala**, conecte GitHub y dé acceso solo
   al repositorio `agente-aml`.
2. **New → Blueprint**, elija el repositorio. Render lee `render.yaml` y propone los cuatro servicios.
3. Llene las variables que pide (las demás ya vienen en `render.yaml`):

   | Servicio | Variable | Valor |
   |---|---|---|
   | aml-api | `SUPABASE_URL` | URL del proyecto (paso 1.9) |
   | aml-api | `SUPABASE_SERVICE_ROLE_KEY` | llave `service_role` |
   | aml-api | `SUPABASE_ANON_KEY` | llave `anon` |
   | aml-api | `META_APP_ID`, `META_APP_SECRET` | de la app de Meta (paso 8); mientras tanto, un valor provisional |
   | aml-api | `META_GRAPH_API_VERSION` | versión vigente de la Graph API (p. ej. `v21.0` o la que indique Meta) |
   | aml-api | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | paso 3.2 |
   | aml-api | `ANTHROPIC_API_KEY` | paso 2.1 |
   | aml-api | `PLATAFORMA_ADMINS` | correos de los administradores de la plataforma, separados por coma |
   | aml-api | `ANCLA_BITACORA_URL` | opcional; vacío por ahora |
   | consola y plataforma | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | URL y llave `anon` |

   `META_VERIFY_TOKEN` lo genera Render; se copia en Meta en el paso 8.
4. Al terminar el primer despliegue, abra los registros (*Logs*) de `aml-api`: si falta alguna variable
   aparece una línea `ATENCIÓN: faltan variables de entorno: …`. Sin esa línea, la configuración está
   completa.

### 6. Dominios y DNS *(usted, en el proveedor del dominio; le dicto los registros)*

En Render, **Settings → Custom Domains** de cada servicio:

| Servicio | Dominio |
|---|---|
| aml-api | `api.amlconsultingguatemala.com` |
| aml-consola | `consola.amlconsultingguatemala.com` |
| aml-plataforma | `plataforma.amlconsultingguatemala.com` |
| aml-portal | `*.clientes.amlconsultingguatemala.com` |

En el DNS del dominio, un registro **CNAME** por cada uno, apuntando a la dirección `….onrender.com`
que muestra Render. Para el comodín del portal, Render pide además unos registros de verificación para
emitir el certificado; los muestra en la misma pantalla. Si el proveedor del dominio no admite
comodines, avíseme y usamos una alternativa.

El sitio web actual de amlconsultingguatemala.com no se toca: solo se agregan subdominios nuevos.

### 7. Primer acceso a la plataforma *(usted)*

1. En Supabase, **Authentication → Users → Invite user**, con un correo que esté en
   `PLATAFORMA_ADMINS`.
2. Acepte la invitación desde el correo, fije la contraseña y entre a
   `https://plataforma.amlconsultingguatemala.com`.
3. En **Listas GAFI**, cargue la versión del último pleno (octubre de 2026). Sin ella el motor de riesgo
   no evalúa.
4. **Designaciones 1373**: si hay alguna comunicada, regístrela. Mientras no haya ninguna, solo se
   exige el cotejo con la lista de la ONU.

### 8. Meta y WhatsApp *(después de la verificación del negocio)*

1. En developers.facebook.com, cree una app de tipo **Negocio** vinculada al portafolio verificado de
   AML Consulting Guatemala y agregue el producto **WhatsApp**.
2. **WhatsApp → Configuración → Webhook**: URL `https://api.amlconsultingguatemala.com/webhooks/whatsapp`,
   token de verificación = `META_VERIFY_TOKEN` de Render; suscriba el campo `messages`.
3. Copie el **App ID** y el **App Secret** a Render (`META_APP_ID`, `META_APP_SECRET`).
4. Solicite el alta como **proveedor tecnológico** para que cada inmobiliaria conecte su número desde la
   plataforma (registro integrado).
5. En la cuenta de WhatsApp de cada inmobiliaria se aprueban las plantillas con estos nombres exactos:
   `aml_bienvenida_expediente`, `aml_recordatorio_pendientes`, `aml_expediente_en_revision`
   (textos en `apps/flujos/src/plantillas.ts`).

### 9. Primera inmobiliaria piloto *(juntos)*

1. **Plataforma → Nueva organización**: datos legales, NIT, subdominio (será
   `<subdominio>.clientes.amlconsultingguatemala.com`) y marca.
2. Invite al administrador de la inmobiliaria, al oficial de cumplimiento y a su suplente. Los roles de
   cumplimiento solo se asignan desde la plataforma (art. 16).
3. Apruebe la metodología de riesgo con el acta del órgano de dirección (art. 8).
4. Conecte su número de WhatsApp.
5. Haga una operación de prueba con un expediente propio, de punta a punta, antes de recibir clientes
   reales.

---

## Verificación final

- [ ] `https://api.amlconsultingguatemala.com/salud` responde `{"ok":true}`.
- [ ] Los registros de `aml-api` no muestran la línea `ATENCIÓN: faltan variables de entorno`.
- [ ] Inngest muestra las 11 funciones y la lista ONU quedó cargada.
- [ ] Supabase: registro público desactivado, bucket `expedientes` privado, esquema `aml` expuesto.
- [ ] Consola y plataforma abren con candado (HTTPS) y aceptan el inicio de sesión.
- [ ] Un enlace de prueba del portal abre con la marca de la inmobiliaria.
- [ ] El webhook de Meta quedó verificado (después del paso 8).

## Respaldo y continuidad

- Supabase Pro hace respaldos diarios; para un registro de conservación obligatoria (art. 34) conviene
  activar además *Point in Time Recovery* cuando haya clientes reales.
- `ANCLA_BITACORA_URL`: cuando se defina un almacenamiento inmutable o un servicio de sellado de tiempo,
  el ancla diaria de la bitácora se envía ahí y deja evidencia externa de su integridad.
