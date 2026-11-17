import { serve as servirNode } from '@hono/node-server';
import { Hono } from 'hono';
import { serve as servirInngest } from 'inngest/hono';
import { apiConsola } from './api-consola.js';
import { apiOperaciones } from './api-operaciones.js';
import { apiPlataforma } from './api-plataforma.js';
import { apiPortal } from './api-portal.js';
import { inngest } from './cliente-inngest.js';
import { config } from './config.js';
import { funciones } from './funciones/index.js';
import { extraerMensajes, firmaValida } from './whatsapp.js';

export const app = new Hono();

/** Variables sin las cuales alguna parte del servidor falla. Ver docs/despliegue.md. */
export const VARIABLES_REQUERIDAS = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'META_APP_SECRET', 'META_VERIFY_TOKEN',
  'META_GRAPH_API_VERSION', 'PORTAL_DOMINIO', 'ONU_LISTA_URL', 'ANTHROPIC_API_KEY', 'CONSOLA_ORIGEN',
  'PLATAFORMA_ORIGEN', 'PLATAFORMA_ADMINS',
] as const;

export function variablesFaltantes(entorno: NodeJS.ProcessEnv = process.env): string[] {
  const faltan: string[] = VARIABLES_REQUERIDAS.filter((v) => !entorno[v]);
  // En producción Inngest exige sus llaves; en local se usa el servidor de desarrollo (INNGEST_DEV)
  if (!entorno.INNGEST_DEV) faltan.push(...['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY'].filter((v) => !entorno[v]));
  return faltan;
}

app.get('/salud', (c) => c.json({ ok: true }));

// Acciones de la consola de cumplimiento
app.route('/api/consola', apiConsola);

// Vista operativa de la inmobiliaria (administrador y ejecutivo)
app.route('/api/operaciones', apiOperaciones);

// Portal del cliente (autenticación por token del enlace)
app.route('/api/portal', apiPortal());

// Administración de la plataforma (alta de organizaciones)
app.route('/api/plataforma', apiPlataforma);

// Flujos durables
app.on(['GET', 'POST', 'PUT'], '/api/inngest', servirInngest({ client: inngest, functions: funciones }));

// Verificación del webhook al configurarlo en Meta
app.get('/webhooks/whatsapp', (c) => {
  const q = c.req.query();
  if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.metaVerifyToken) {
    return c.text(q['hub.challenge'] ?? '');
  }
  return c.text('forbidden', 403);
});

// Un solo receptor para todos los números; la organización se identifica por phone_number_id
app.post('/webhooks/whatsapp', async (c) => {
  const cuerpo = await c.req.text();
  if (!firmaValida(cuerpo, c.req.header('x-hub-signature-256'), config.metaAppSecret)) {
    return c.text('firma inválida', 401);
  }
  const mensajes = extraerMensajes(JSON.parse(cuerpo));
  if (mensajes.length) {
    await inngest.send(mensajes.map((m) => ({ name: 'aml/whatsapp.mensaje' as const, data: m, id: m.mensajeId })));
  }
  return c.text('ok');
});

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const port = Number(process.env.PORT ?? 3000);
  const faltan = variablesFaltantes();
  if (faltan.length) console.error(`ATENCIÓN: faltan variables de entorno: ${faltan.join(', ')}. Ver docs/despliegue.md`);
  servirNode({ fetch: app.fetch, port });
  console.log(`Flujos en http://localhost:${port}`);
}
