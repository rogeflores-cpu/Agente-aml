import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

let cliente: SupabaseClient<any, 'aml', any> | undefined;

/** Cliente con llave de servicio sobre el esquema 'aml'. Solo en el servidor. */
export function db() {
  cliente ??= createClient(config.supabaseUrl, config.supabaseServiceKey, {
    db: { schema: 'aml' },
    auth: { persistSession: false },
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
}
