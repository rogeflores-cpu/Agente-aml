# Agente AML

Plataforma de vinculación de clientes para Personas Obligadas del Decreto 15-2026
(Ley Integral para la Prevención y Represión del Lavado de Dinero u Otros Activos y
del Financiamiento del Terrorismo). Primera vertical: inmobiliarias (art. 3 c.1.i).

El agente prepara el expediente; la decisión de aceptar al cliente es siempre de la
persona autorizada (oficial de cumplimiento o quien ejerza la función).

## Estado: fase 1, base del sistema

| Pieza | Contenido | Pruebas |
|---|---|---|
| `supabase/migrations` | Esquema `aml`: organizaciones con marca y canal de WhatsApp propio, operaciones, expedientes por parte (comprador y vendedor), personas relacionadas, documentos con SHA-256, datos con procedencia, pendientes, verificaciones, alertas, evaluaciones de riesgo, decisiones, registro de efectivo, bitácora encadenada, mensajes y notificaciones. Seguridad por organización y por rol. | 17 pruebas SQL |
| `packages/riesgo` | Motor de riesgo determinista con los cuatro factores del art. 9, reglas que se imponen al puntaje (ONU, GAFI, PEP, DDC incompleta, transacción inusual), señales de alerta del sector, registro de efectivo del art. 31 y aplicación de la lista GAFI vigente. | 19 pruebas |
| `packages/listas` | Lectura del XML consolidado de la ONU, normalización de nombres y cotejo aproximado sin importar orden, tildes ni formas societarias. Detección de cambios entre versiones. | 9 pruebas |
| `packages/agente` | Agente conversacional del cliente (Claude Haiku) con 4 herramientas acotadas; catálogo de información y documentos por parte y tipo de persona; revisor determinista de faltantes, ilegibles, vencidos y contradicciones; clasificador y lector de documentos (Claude Sonnet); prellenado desde documentos. | 26 pruebas |
| `apps/flujos` | Servidor con el receptor único de WhatsApp (firma de Meta, enrutamiento por número), 8 flujos durables en Inngest, repositorio del lado del cliente, procesamiento de documentos y la API de la consola (evaluar, disponer, decidir, cerrar alertas, enlaces temporales a documentos, carga de listas GAFI). | 25 pruebas |
| `apps/consola` | Consola de cumplimiento en React: bandeja con prioridades, expediente con datos y su procedencia, documentos, listas, riesgo, alertas, decisión y bitácora; avisos. Modo demostración con datos ficticios y el motor de riesgo real. | 3 pruebas + recorrido en navegador |

### Flujos durables

| Flujo | Disparador | Qué hace |
|---|---|---|
| `expediente-creado` | Alta de operación | Genera el enlace con la marca de la organización, envía la plantilla de bienvenida y hasta 3 recordatorios cada 2 días. |
| `cotejo-onu-inicial` | Cliente o persona relacionada identificada | Coteja contra la lista ONU vigente y avisa solo a cumplimiento. |
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
pnpm --filter @agente-aml/consola demo   # datos ficticios, sin Supabase: http://localhost:5173
pnpm --filter @agente-aml/consola dev    # conectada (variables VITE_* en variables-entorno.ejemplo)
```

- Solo entran oficial, suplente y auditor. Las lecturas van directo a Supabase con sus permisos;
  las acciones pasan por `/api/consola` con el token del usuario, para que apliquen las políticas
  y disparadores (solo el oficial decide, no se aprueba con coincidencias sin disponer, etc.).
- Confirmar una coincidencia ONU dispara el flujo de 24 horas; aprobar con verificación diferida
  dispara el flujo de los 3 meses; cerrar una alerta detiene el escalamiento.
- La evaluación de riesgo combina el expediente con el criterio del oficial (presencialidad,
  coherencia perfil-monto, transacción inusual, tipo de cambio) y queda guardada con ambos.

## Siguiente

1. Portal web del cliente con la marca de cada organización (carga de documentos y el mismo agente
   en canal `web`) y pantalla del ejecutivo para registrar operaciones.
2. Alta de organizaciones: metodología de riesgo base para aprobación, usuarios y conexión del número
   de WhatsApp (registro integrado de Meta).
3. Antes de producción: validar el lector de la lista ONU con el archivo oficial vigente, probar el
   agente con documentos reales y cargar la versión vigente de las listas del GAFI.
