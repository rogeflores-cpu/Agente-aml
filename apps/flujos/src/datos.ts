import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { correoAvisoCumplimiento, correoDisponible, correoValido, enviarCorreo } from './correo.js';

let cliente: SupabaseClient<any, 'aml', any> | undefined;

/**
 * Actor de la bitácora para las escrituras que el servidor hace en nombre de
 * alguien (el cliente en el portal o WhatsApp, el agente al extraer un
 * documento). Se propaga con AsyncLocalStorage y viaja en las cabeceras
 * x-aml-actor-tipo / x-aml-actor-id, que la base solo acepta cuando la
 * solicitud usa la llave de servicio (aml.actor_declarado). Sin actor, la base
 * deduce el origen o registra 'sistema'.
 */
export interface ActorBitacora { tipo: 'cliente' | 'agente' | 'sistema'; id?: string }
const actorActual = new AsyncLocalStorage<ActorBitacora>();

export function conActor<T>(actor: ActorBitacora, fn: () => T): T {
  return actorActual.run(actor, fn);
}

/** Cabeceras de actor para la solicitud en curso (exportada para pruebas). */
export function cabecerasActor(actor: ActorBitacora | undefined = actorActual.getStore()): Record<string, string> {
  if (!actor) return {};
  const h: Record<string, string> = { 'x-aml-actor-tipo': actor.tipo };
  if (actor.id) h['x-aml-actor-id'] = actor.id.slice(0, 120);
  return h;
}

const fetchConActor: typeof fetch = (entrada, init) => {
  const extra = cabecerasActor();
  if (!Object.keys(extra).length) return fetch(entrada, init);
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return fetch(entrada, { ...init, headers });
};

/** Cliente con llave de servicio sobre el esquema 'aml'. Solo en el servidor. */
export function db() {
  cliente ??= createClient(config.supabaseUrl, config.supabaseServiceKey, {
    db: { schema: 'aml' },
    auth: { persistSession: false },
    global: { fetch: fetchConActor },
  });
  return cliente;
}

export async function sinError<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export async function canalDeOrganizacion(organizacionId: string) {
  const canal = await sinError(
    db().from('canales_whatsapp').select('phone_number_id, estado').eq('organizacion_id', organizacionId).maybeSingle(),
  );
  if (!canal || canal.estado !== 'activo') return null;
  const token = await sinError(db().rpc('token_canal', { p_phone_number_id: canal.phone_number_id }));
  if (!token) return null;
  return { phoneNumberId: canal.phone_number_id as string, token: token as string, graphApiVersion: config.graphApiVersion };
}

export async function notificar(
  organizacionId: string,
  destinatarioRol: 'cumplimiento' | 'operativo',
  asunto: string,
  cuerpo: string,
  opciones: { expedienteId?: string; prioridad?: 'normal' | 'alta' | 'urgente' } = {},
) {
  await sinError(
    db().from('notificaciones').insert({
      organizacion_id: organizacionId,
      destinatario_rol: destinatarioRol,
      asunto,
      cuerpo,
      expediente_id: opciones.expedienteId ?? null,
      prioridad: opciones.prioridad ?? 'normal',
    }),
  );
  // Los avisos de cumplimiento de prioridad alta o urgente también van por correo al
  // oficial y al suplente (p. ej., el plazo de 24 horas del art. 43). Un fallo del
  // correo no impide el aviso en la consola.
  if (destinatarioRol === 'cumplimiento' && (opciones.prioridad === 'alta' || opciones.prioridad === 'urgente') && correoDisponible()) {
    try {
      await avisarPorCorreo(organizacionId, asunto, opciones.prioridad, opciones.expedienteId);
    } catch (e) {
      console.error('No se pudo enviar el aviso de cumplimiento por correo:', (e as Error).message);
    }
  }
}

/** Correos de los oficiales (titular y suplente) activos de la organización. */
export async function correosCumplimiento(organizacionId: string): Promise<string[]> {
  const miembros = (await sinError(
    db().from('miembros').select('usuario_id').eq('organizacion_id', organizacionId).eq('activo', true)
      .in('rol', ['oficial', 'oficial_suplente']),
  )) as { usuario_id: string }[];
  const correos: string[] = [];
  for (const m of miembros ?? []) {
    const { data } = await db().auth.admin.getUserById(m.usuario_id);
    const correo = data?.user?.email;
    if (correoValido(correo) && data?.user?.email_confirmed_at) correos.push(correo);
  }
  return correos;
}

async function avisarPorCorreo(organizacionId: string, asunto: string, prioridad: 'alta' | 'urgente', expedienteId?: string) {
  const [org, destinatarios] = await Promise.all([
    sinError(db().from('organizaciones').select('nombre_comercial').eq('id', organizacionId).single()),
    correosCumplimiento(organizacionId),
  ]);
  const organizacion = (org as { nombre_comercial: string }).nombre_comercial;
  const correo = correoAvisoCumplimiento({ organizacion, asuntoAviso: asunto, prioridad, consola: config.consolaOrigen, expedienteId });
  for (const para of destinatarios) {
    await enviarCorreo({ para, nombreRemitente: 'Cumplimiento AML', ...correo });
  }
}
