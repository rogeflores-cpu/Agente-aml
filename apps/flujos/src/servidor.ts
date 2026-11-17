import { serve as servirNode } from '@hono/node-server';
import { Hono } from 'hono';
import { serve as servirInngest } from 'inngest/hono';
import { apiConsola } from './api-consola.js';
import { inngest } from './cliente-inngest.js';
import { config } from './config.js';
import { funciones } from './funciones/index.js';
import { extraerMensajes, firmaValida } from './whatsapp.js';

export const app = new Hono();

app.get('/salud', (c) => c.json({ ok: true }));

// Acciones de la consola de cumplimiento
app.route('/api/consola', apiConsola);

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
  servirNode({ fetch: app.fetch, port });
  console.log(`Flujos en http://localhost:${port}`);
}
