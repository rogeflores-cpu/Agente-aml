# Agente AML

Plataforma de vinculación de clientes para Personas Obligadas del Decreto 15-2026
(Ley Integral para la Prevención y Represión del Lavado de Dinero u Otros Activos y
del Financiamiento del Terrorismo). Primera vertical: inmobiliarias (art. 3 c.1.i).

El agente prepara el expediente; la decisión de aceptar al cliente es siempre de la
persona autorizada (oficial de cumplimiento o quien ejerza la función).

## Estado: fase 1, base del sistema

| Pieza | Contenido | Pruebas |
|---|---|---|
| `supabase/migrations` | Esquema `aml` (16 migraciones): organizaciones con marca y canal de WhatsApp propio, operaciones, expedientes por parte, datos con procedencia, documentos con SHA-256, verificaciones, alertas, riesgo, decisiones, efectivo, bitácora encadenada con secuencia y ancla. Seguridad por organización y rol; acciones sensibles solo por funciones que validan el rol; estado comercial separado (art. 38); designaciones S/RES/1373 y bloqueo preventivo (art. 43). | 81 + 7 grupos del art. 43 (8 archivos SQL, incluida la integración de punta a punta) |
| `packages/riesgo` | Motor de riesgo determinista: cuatro factores (art. 9), reglas ONU/GAFI/PEP/DDC, señales del sector, efectivo (art. 31), lista GAFI vigente. | 19 |
| `packages/listas` | Lista consolidada ONU: lectura del XML, normalización y cotejo aproximado, cambios entre versiones. | 9 |
| `packages/agente` | Agente conversacional del cliente, catálogo por parte y tipo de persona (incluye cargo público de representante y beneficiarios finales), revisor, clasificador y lector de documentos, prellenado, términos reservados. | 48 |
| `apps/flujos` | Servidor: webhook de WhatsApp, API de consola, operaciones, portal y plataforma; 11 flujos durables. | 104 |
| `apps/consola` | Consola: bandeja de cumplimiento (oficial, suplente, auditor) y vista operativa (administrador, ejecutivo: registrar operaciones, reenviar enlaces, efectivo). Bloqueo preventivo y comunicación al MP. Modo demostración. | 16 + recorrido en navegador |
| `apps/portal` | Portal del cliente con la marca de la organización: conversación con el agente, carga de documentos, pendientes, envío a revisión, paso a WhatsApp. Modo demostración. | 7 + recorrido en navegador |
| `apps/plataforma` | Administración: alta de organizaciones por pasos, usuarios, aprobación de metodología (art. 8), conexión de WhatsApp (manual o registro integrado de Meta), listas GAFI, designaciones S/RES/1373, avisos. Modo demostración. | 8 + recorrido en navegador |

### Flujos durables

| Flujo | Disparador | Qué hace |
|---|---|---|
| `expediente-creado` | Alta de operación | Genera el enlace con la marca de la organización, envía la plantilla de bienvenida y hasta 3 recordatorios cada 2 días. |
| `cotejo-onu-inicial` | Cliente o persona relacionada identificada | Coteja contra la lista ONU vigente y, si hay alguna registrada, contra las designaciones S/RES/1373; avisa solo a cumplimiento. |
| `designacion-1373-registrada` | La plataforma registra una designación | Coteja toda la cartera activa contra la designación nueva (control permanente, art. 43). |
| `lista-onu-diaria` | Diario, 5:00 Guatemala | Descarga la lista; si cambió, guarda la versión y recoteja la cartera activa solo contra altas y cambios (control permanente, art. 43). |
| `plazo-onu-24h` | Coincidencia confirmada | Abre alerta con vencimiento a 24 horas, escala a las 20 horas y deja constancia si vence. |
| `verificacion-diferida` | Aprobación con verificación diferida | Aviso 15 días antes y alerta al vencer los 3 meses (art. 22). |
| `actualizacion-periodica` | Lunes, 7:00 | Avisa las actualizaciones de clientes que vencen en 30 días. |
| `whatsapp-entrante` | Mensaje recibido | Identifica la organización por su número, vincula al cliente con el código de 6 dígitos, procesa fotos o PDF (guarda con SHA-256, identifica, lee y prellena) y responde con el agente. Un cliente a la vez, en orden. |
| `revisar-lista-gafi` | Lunes, 8:00 | Avisa al administrador de la plataforma si falta cargar las listas del último pleno del GAFI. |

## Reglas de diseño que el código hace cumplir

- **No revelación (art. 38).** Los roles operativos (administrador, ejecutivo) no leen
  expedientes, verificaciones, alertas, riesgo, decisiones ni bitácora; trabajan con
  vistas donde `en_examen` aparece como `en_revision`. Todo texto que sale al cliente
  pasa por `verificarNeutralidad()`, que bloquea términos reservados.
- **Solo el oficial decide.** Un disparador rechaza decisiones de cualquier otro rol y
  aprobaciones con coincidencias sin disponer. Las decisiones no se modifican ni se borran.
- **Bitácora íntegra.** Cada evento se encadena con SHA-256 por organización;
  `aml.verificar_bitacora(org)` detecta cualquier alteración.
- **Límites legales en la base.** Verificación diferida de máximo 3 meses (art. 22),
  beneficiario final con 15 % o control por otro medio (art. 2 b), conservación de 5 años
  desde el fin de la relación (art. 34), efectivo diario agregado para el umbral de USD 10,000 (art. 31).
- **Riesgo sin IA.** El puntaje lo calcula `@agente-aml/riesgo`; cada evaluación guarda la
  entrada, la versión de la metodología aprobada y la explicación línea por línea.
- **Parámetros del reglamento.** Lo que defina el reglamento (umbrales, montos, plazos de RTS)
  se configura en `configuraciones_riesgo`, no en el código.

## Cómo correrlo

```bash
pnpm install
pnpm test          # paquetes y flujos
pnpm typecheck
DATABASE_URL=postgres://postgres@localhost:5432/aml_test pnpm test:db   # migraciones + pruebas SQL
```

Flujos en local: copiar `variables-entorno.ejemplo` a `.env`, levantar `npx inngest-cli dev` y luego
`pnpm --filter @agente-aml/flujos dev`.

Despliegue en Supabase: `supabase db push` con las migraciones, y exponer el esquema `aml`
en la configuración de la API. El token de WhatsApp de cada organización se guarda en
Supabase Vault y se referencia en `canales_whatsapp.token_secret_id`.

## WhatsApp: un número por sujeto obligado

Cada organización conecta su propio número (registro integrado de Meta) y aprueba en su
cuenta las plantillas de `apps/flujos/src/plantillas.ts` con los mismos nombres:
`aml_bienvenida_expediente`, `aml_recordatorio_pendientes`, `aml_expediente_en_revision`.
Un solo receptor (`POST /webhooks/whatsapp`) valida la firma y enruta por `phone_number_id`.

## Agente conversacional

- **Frontera del art. 38 en el tipo de datos.** El agente solo recibe `VistaCliente`
  (datos, documentos y pendientes). El repositorio que la arma no consulta verificaciones,
  alertas, riesgo ni decisiones; el estado llega ya traducido a texto neutro.
- **Herramientas acotadas:** `ver_expediente`, `guardar_dato` (solo campos del catálogo y
  opciones válidas), `confirmar_dato` y `enviar_a_revision` (solo sin pendientes).
- **Respuesta revisada:** si el texto del modelo contiene un término reservado, se sustituye
  por una respuesta neutra y se avisa a cumplimiento.
- **Documentos:** cada archivo se guarda con SHA-256, se identifica, se lee con su página y
  confianza, y los datos se proponen al cliente para confirmar; nunca sobrescriben lo declarado.
  Las diferencias las detecta el revisor como contradicciones.
- **Cotejo automático:** al confirmarse el nombre del cliente, de la entidad, del representante
  o de los beneficiarios finales, se dispara el cotejo con la lista ONU.

## Listas ONU y GAFI

- **ONU:** el XML consolidado es público; `lista-onu-diaria` lo descarga y recoteja la cartera.
- **GAFI:** no tiene descarga automática. Después de cada pleno (febrero, junio, octubre) se
  registra una versión en `aml.listas_gafi` con las dos listas y sus URL oficiales; las versiones
  no se modifican. El motor de riesgo usa la vigente con `aplicarListaGafi()`.

## Consola de cumplimiento

```bash
pnpm --filter @agente-aml/consola demo     # http://localhost:5173 (elegir rol oficial o ejecutivo)
pnpm --filter @agente-aml/portal demo      # http://localhost:5174
pnpm --filter @agente-aml/plataforma demo  # http://localhost:5175
pnpm --filter @agente-aml/consola dev    # conectada (variables VITE_* en variables-entorno.ejemplo)
```

- Solo entran oficial, suplente y auditor. Las lecturas van directo a Supabase con sus permisos;
  las acciones pasan por `/api/consola` con el token del usuario, para que apliquen las políticas
  y disparadores (solo el oficial decide, no se aprueba con coincidencias sin disponer, etc.).
- Confirmar una coincidencia ONU dispara el flujo de 24 horas; aprobar con verificación diferida
  dispara el flujo de los 3 meses; cerrar una alerta detiene el escalamiento.
- La evaluación de riesgo combina el expediente con el criterio del oficial (presencialidad,
  coherencia perfil-monto, transacción inusual, tipo de cambio) y queda guardada con ambos.

## Revisión independiente

`docs/revision-independiente-2026-11-16.md`: 2 hallazgos críticos, 6 altos y 10 medios sobre seguridad,
aislamiento entre organizaciones, art. 38 y correspondencia con el decreto. Corregidos en las migraciones
`20261117001200_correcciones_seguridad.sql` y `20261117001300_integracion.sql` y en la aplicación, con
pruebas que reproducen cada ataque (`supabase/tests/30_correcciones.sql`, `40_integracion_app.sql`).
Los tres puntos que quedaron abiertos por decisión de diseño se cerraron en
`20261118001500_art43_designaciones_y_bloqueo.sql` (pruebas en `supabase/tests/50_art43.sql`):

- **Designaciones de la S/RES/1373 (art. 43 c).** La plataforma las registra a mano (pantalla
  «Designaciones 1373») con la autoridad, la referencia del documento y la fecha; no se modifican ni se
  borran, se revocan. Se cotejan con el mismo motor que la lista ONU y, al registrar una, se coteja toda la
  cartera activa. Si existe al menos una designación, aprobar exige el cotejo 1373 de cada persona.
- **Bloqueo preventivo.** Al confirmarse una coincidencia (ONU o 1373) la base registra en la misma
  transacción un bloqueo de la persona en toda la organización: no se aprueba ningún expediente donde
  aparezca, no se cierra con escritura ninguna operación suya (sí se puede cancelar; mensaje neutro al área
  comercial) y cada pago en efectivo que se registre avisa de urgencia a cumplimiento. La alerta confirmada
  no se cierra sin registrar la comunicación escrita al Ministerio Público (fecha, referencia y documento);
  queda constancia de si se hizo dentro de las 24 horas. El oficial levanta el bloqueo solo con motivo y
  referencia de la resolución.
- **Criterios del oficial de cumplimiento (17-nov-2026)**, migración `20261118001600_liberacion_homonimos.sql`
  y pruebas en `supabase/tests/51_liberacion_homonimos.sql`:
  1. El bloqueo se extiende por nombre a los demás expedientes de la organización. En cada uno, el oficial
     lo marca como **homónimo** o **chequeo verificado**, con los datos comparados, y asume la
     responsabilidad de liberarlo (queda su nombre, su rol y la hora en la bitácora; no se modifica ni se
     borra). La liberación vale solo para ese expediente: el de la coincidencia confirmada no se libera, se
     levanta con resolución.
  2. El cotejo con las designaciones 1373 se exige solo a partir de que exista al menos una registrada;
     mientras no haya ninguna, basta el cotejo con la lista de la ONU.
  3. El plazo de 24 horas para comunicar al Ministerio Público se cuenta desde la detección de la
     coincidencia. Si el manual de la organización adopta otro criterio, se ajusta.
- **Cotejo de cada persona en la base.** Aprobar exige un cotejo sin coincidencia (o descartado) de cada
  nombre identificado: cliente o razón social, representante y cada beneficiario final.

## Despliegue

Producción en Render (`render.yaml`) con Supabase e Inngest, bajo `amlconsultingguatemala.com`:
`api.`, `consola.`, `plataforma.` y `<organización>.clientes.`. Guía paso a paso en `docs/despliegue.md`.

## Siguiente

1. Montaje en un proyecto Supabase real, proveedor tecnológico de Meta y plantillas aprobadas; prueba con
   documentos y conversaciones reales.
2. Botón para cerrar la operación en la consola y pantalla del oficial para corregir datos.
3. Piloto con dos o tres inmobiliarias.
