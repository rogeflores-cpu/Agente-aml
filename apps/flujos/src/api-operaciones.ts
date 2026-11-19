import { DEPARTAMENTOS_GUATEMALA, errorRegistral, municipioValido, normalizarFinca, normalizarLibro } from '@agente-aml/riesgo';
import { createClient } from '@supabase/supabase-js';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { inngest } from './cliente-inngest.js';
import { config } from './config.js';
import { canalDeOrganizacion, db, sinError } from './datos.js';
import { nuevoEnlace } from './enlaces.js';
import { correoCliente, correoDisponible, correoValido, enviarCorreo } from './correo.js';
import { enviarPlantilla } from './whatsapp.js';

/**
 * API de la vista operativa de la inmobiliaria (administrador y ejecutivo).
 *
 * Art. 38: nada de lo que responde esta API incluye verificaciones, alertas,
 * riesgo, decisiones ni el estado real del expediente. Las escrituras se hacen
 * con el token del usuario para que apliquen su rol y las políticas de la base.
 */
type Vars = { usuarioId: string; token: string };
export const apiOperaciones = new Hono<{ Variables: Vars }>();

const ROLES_OPERATIVOS = ['administrador', 'ejecutivo', 'oficial', 'oficial_suplente'];

apiOperaciones.use('*', cors({ origin: (o) => (o === config.consolaOrigen ? o : null), allowHeaders: ['Authorization', 'Content-Type'] }));

apiOperaciones.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next();
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return c.json({ error: 'Sesión requerida' }, 401);
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) return c.json({ error: 'Sesión inválida' }, 401);
  c.set('usuarioId', data.user.id);
  c.set('token', token);
  await next();
});

const comoUsuario = (c: Context<{ Variables: Vars }>) =>
  createClient(config.supabaseUrl, config.supabaseAnonKey, {
    db: { schema: 'aml' },
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${c.get('token')}` } },
  });

async function rolEn(organizacionId: string, usuarioId: string) {
  const m = await sinError(
    db().from('miembros').select('rol').eq('organizacion_id', organizacionId).eq('usuario_id', usuarioId).eq('activo', true).maybeSingle(),
  );
  return (m as { rol: string } | null)?.rol ?? null;
}

const invalido = (c: Context, e: z.ZodError) =>
  c.json({ error: 'Datos inválidos', detalle: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400);

// ------------------------------------------------------------- esquemas
const MEDIOS = ['efectivo', 'transferencia_local', 'transferencia_exterior', 'cheque', 'financiamiento_bancario', 'activos_virtuales', 'otro'] as const;
const moneda = z.string().regex(/^[A-Z]{3}$/, 'Código de moneda ISO de 3 letras');
const telefono = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Formato internacional, p. ej. +50255550000');

export const esquemaParte = z.object({
  parte: z.enum(['comprador', 'vendedor']),
  tipoPersona: z.enum(['individual', 'juridica', 'estructura']),
  nombre: z.string().trim().min(3, 'Nombre muy corto').max(200),
  telefono: telefono.optional(),
  correo: z.string().email('Correo inválido').optional(),
}).refine((p) => p.telefono || p.correo, { message: 'Indique teléfono o correo', path: ['telefono'] });

export const esquemaOperacion = z.object({
  organizacionId: z.string().uuid(),
  tipo: z.enum(['compraventa', 'intermediacion']),
  // Departamento y municipio del catálogo oficial; finca, folio y libro siempre por separado
  inmueble: z.object({
    departamento: z.string().trim().refine((d) => DEPARTAMENTOS_GUATEMALA.includes(d), 'Departamento inválido'),
    municipio: z.string().trim().min(1, 'Indique el municipio'),
    finca: z.string().trim().transform(normalizarFinca).optional(),
    folio: z.string().trim().transform(normalizarFinca).optional(),
    libro: z.string().trim().transform(normalizarLibro).optional(),
    direccion: z.string().trim().max(300).optional(),
  }).superRefine((i, ctx) => {
    if (!municipioValido(i.departamento, i.municipio)) {
      ctx.addIssue({ code: 'custom', path: ['municipio'], message: `El municipio no corresponde a ${i.departamento}` });
    }
    const r = errorRegistral(i);
    if (r) ctx.addIssue({ code: 'custom', path: [r.campo], message: r.mensaje });
  }),
  precio: z.number().positive().max(1e12).optional(),
  moneda: moneda.default('GTQ'),
  valorReferencia: z.number().positive().max(1e12).optional(),
  formaPago: z.array(z.object({
    medio: z.enum(MEDIOS),
    monto: z.number().positive(),
    moneda: moneda.optional(),
    pagador: z.enum(['cliente', 'tercero']),
  })).max(20).default([]),
  partes: z.array(esquemaParte).min(1, 'Indique al menos una parte').max(6),
}).refine((o) => o.formaPago.length === 0 || !o.precio || o.formaPago.reduce((s, p) => s + (p.moneda && p.moneda !== o.moneda ? 0 : p.monto), 0) <= o.precio * 1.0001, {
  message: 'La forma de pago suma más que el precio', path: ['formaPago'],
});

export const esquemaPagoEfectivo = z.object({
  expedienteId: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monto: z.number().positive(),
  moneda,
  tipoCambioUsd: z.number().positive(),
}).refine((p) => p.fecha <= new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' }), {
  message: 'La fecha no puede ser futura (hora de Guatemala)', path: ['fecha'],
});

// ----------------------------------------------------- registrar operación
apiOperaciones.post('/operaciones', async (c) => {
  const cuerpo = esquemaOperacion.safeParse(await c.req.json().catch(() => ({})));
  if (!cuerpo.success) return invalido(c, cuerpo.error);
  const d = cuerpo.data;
  const rol = await rolEn(d.organizacionId, c.get('usuarioId'));
  if (!rol || !ROLES_OPERATIVOS.includes(rol)) return c.json({ error: 'Sin permiso para registrar operaciones' }, 403);

  // Como el usuario: la función valida su rol y deja su id como autor.
  const { data, error } = await comoUsuario(c).rpc('crear_operacion', {
    p_organizacion: d.organizacionId,
    p_tipo: d.tipo,
    p_inmueble: d.inmueble,
    p_precio: d.precio ?? null,
    p_moneda: d.moneda,
    p_forma_pago: d.formaPago,
    p_partes: d.partes.map((p) => ({
      parte: p.parte, tipo_persona: p.tipoPersona, contacto_nombre: p.nombre,
      contacto_telefono: p.telefono ?? null, contacto_correo: p.correo ?? null,
    })),
  });
  if (error) return c.json({ error: error.message }, error.code === '42501' ? 403 : 400);
  const filas = (data ?? []) as { operacion_id: string; codigo: string; expediente_id: string; parte: string }[];
  if (!filas.length) return c.json({ error: 'No se creó la operación' }, 500);

  if (d.valorReferencia) {
    await sinError(db().from('operaciones').update({ valor_referencia: d.valorReferencia }).eq('id', filas[0].operacion_id));
  }
  await inngest.send(filas.map((f) => ({
    name: 'aml/expediente.creado' as const,
    data: { organizacionId: d.organizacionId, expedienteId: f.expediente_id },
  })));
  return c.json({
    operacionId: filas[0].operacion_id,
    codigo: filas[0].codigo,
    expedientes: filas.map((f) => ({ id: f.expediente_id, parte: f.parte })),
  }, 201);
});

// ------------------------------------------------------- reenviar enlace
/**
 * Se usa el estado comercial (aml.expedientes.estado_comercial), que la base
 * mantiene fijo cuando cumplimiento abre un examen después de resolver. Con el
 * estado real, un expediente aprobado y luego en examen volvía a admitir el
 * reenvío y delataba el examen al área comercial (art. 38).
 */
export const ESTADOS_COMERCIALES_FINALES = ['aprobado', 'no_aprobado'];

apiOperaciones.post('/expedientes/:id/reenviar-enlace', async (c) => {
  const exp = (await sinError(
    db().from('expedientes')
      .select('id, organizacion_id, estado_comercial, contacto_nombre, contacto_telefono, contacto_correo, organizaciones(subdominio, nombre_comercial, marca)')
      .eq('id', c.req.param('id')).maybeSingle(),
  )) as any;
  if (!exp) return c.json({ error: 'Expediente no encontrado' }, 404);
  const rol = await rolEn(exp.organizacion_id, c.get('usuarioId'));
  if (!rol || !ROLES_OPERATIVOS.includes(rol)) return c.json({ error: 'Expediente no encontrado' }, 404);
  // Mismo trato para cualquier estado en curso, incluido el examen (art. 38).
  if (ESTADOS_COMERCIALES_FINALES.includes(exp.estado_comercial)) return c.json({ error: 'El expediente ya fue resuelto' }, 409);

  const org = exp.organizaciones;
  const enlace = nuevoEnlace(org.subdominio, config.dominioPortal, config.enlaceVigenciaDias);
  await sinError(db().from('expedientes').update({ enlace_token_hash: enlace.tokenHash, enlace_expira_en: enlace.expiraEn }).eq('id', exp.id));

  const nombreVisible = (org.marca?.nombre_visible ?? org.nombre_comercial) as string;
  const canal = exp.contacto_telefono ? await canalDeOrganizacion(exp.organizacion_id) : null;
  if (!canal) {
    if (correoDisponible() && correoValido(exp.contacto_correo)) {
      try {
        const id = await enviarCorreo({
          para: exp.contacto_correo, nombreRemitente: nombreVisible,
          ...correoCliente('recordatorio', { nombre: exp.contacto_nombre, organizacion: nombreVisible, enlace: enlace.url, venceEn: enlace.expiraEn, color: org.marca?.color_primario }),
        });
        await sinError(db().from('mensajes').insert({
          organizacion_id: exp.organizacion_id, expediente_id: exp.id, direccion: 'saliente', canal: 'correo',
          correo_id: id, tipo: 'plantilla', plantilla: 'recordatorio',
        }));
        return c.json({ canal: 'correo', expiraEn: enlace.expiraEn });
      } catch (e) {
        console.error('No se pudo enviar el enlace por correo:', (e as Error).message);
        // Si el correo falla, el ejecutivo lo comparte a mano
      }
    }
    // Sin WhatsApp ni correo: el ejecutivo comparte el enlace por otro medio.
    return c.json({ canal: 'manual', url: enlace.url, expiraEn: enlace.expiraEn });
  }
  const destino = String(exp.contacto_telefono).replace(/[^\d]/g, '');
  const id = await enviarPlantilla(canal, destino, 'recordatorio', [exp.contacto_nombre, nombreVisible, enlace.url]);
  await sinError(db().from('mensajes').insert({
    organizacion_id: exp.organizacion_id, expediente_id: exp.id, direccion: 'saliente',
    wa_id: destino, wa_message_id: id ?? null, tipo: 'template', plantilla: 'recordatorio',
  }));
  return c.json({ canal: 'whatsapp', expiraEn: enlace.expiraEn });
});

// ------------------------------------------------------- efectivo (art. 31)
apiOperaciones.post('/pagos-efectivo', async (c) => {
  const cuerpo = esquemaPagoEfectivo.safeParse(await c.req.json().catch(() => ({})));
  if (!cuerpo.success) return invalido(c, cuerpo.error);
  const d = cuerpo.data;
  const exp = (await sinError(
    db().from('expedientes').select('id, organizacion_id, operacion_id, cliente_id').eq('id', d.expedienteId).maybeSingle(),
  )) as { id: string; organizacion_id: string; operacion_id: string; cliente_id: string | null } | null;
  if (!exp) return c.json({ error: 'Expediente no encontrado' }, 404);
  const rol = await rolEn(exp.organizacion_id, c.get('usuarioId'));
  if (!rol || rol === 'auditor') return c.json({ error: 'Sin permiso para registrar pagos' }, 403);

  const { error } = await comoUsuario(c).from('pagos_efectivo').insert({
    organizacion_id: exp.organizacion_id,
    operacion_id: exp.operacion_id,
    expediente_id: exp.id,
    cliente_id: exp.cliente_id,
    fecha: d.fecha,
    monto: d.monto,
    moneda: d.moneda,
    tipo_cambio_usd: d.tipoCambioUsd,
    registrado_por: c.get('usuarioId'),
  });
  if (error) return c.json({ error: error.message }, error.code === '42501' ? 403 : 400);
  // Respuesta mínima: el control del umbral lo revisa cumplimiento.
  return c.json({ ok: true }, 201);
});

// ------------------------------------------------- cerrar la operación
// Fin de la relación (art. 30: el plazo de conservación corre desde aquí). La
// base valida el rol (cualquier miembro activo salvo el auditor), que la
// operación siga abierta y fija fin_relacion en sus expedientes.
apiOperaciones.post('/operaciones/:id/cerrar', async (c) => {
  const cuerpo = z.object({ estado: z.enum(['cerrada', 'cancelada']) }).safeParse(await c.req.json().catch(() => ({})));
  if (!cuerpo.success) return invalido(c, cuerpo.error);
  const { error } = await comoUsuario(c).rpc('cerrar_operacion', { p_operacion: c.req.param('id'), p_estado: cuerpo.data.estado });
  if (error) {
    if (error.code === '42501') return c.json({ error: 'Operación no encontrada' }, 404); // B5: no revelar otras organizaciones
    if (error.code === '22023') return c.json({ error: error.message }, 400);
    return c.json({ error: error.message }, 409);
  }
  return c.json({ ok: true });
});
