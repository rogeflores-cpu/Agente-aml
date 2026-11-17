import { configuracionBaseInmobiliaria, validarConfiguracion, type ConfiguracionRiesgo } from '@agente-aml/riesgo';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { config } from './config.js';
import { db, sinError } from './datos.js';

/**
 * API de administración de la plataforma: alta de organizaciones (sujetos
 * obligados), usuarios, aprobación de la metodología de riesgo (art. 8),
 * conexión del número de WhatsApp de cada organización y avisos.
 * Solo para los administradores de la plataforma (PLATAFORMA_ADMINS).
 * Todas las operaciones usan la llave de servicio.
 */
type Vars = { usuarioId: string; correo: string };
export const apiPlataforma = new Hono<{ Variables: Vars }>();

const origenPlataforma = () => process.env.PLATAFORMA_ORIGEN ?? 'http://localhost:5174';

apiPlataforma.use('*', cors({ origin: (o) => (o === origenPlataforma() ? o : null), allowHeaders: ['Authorization', 'Content-Type'] }));

apiPlataforma.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next();
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return c.json({ error: 'Sesión requerida' }, 401);
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) return c.json({ error: 'Sesión inválida' }, 401);
  const correo = (data.user.email ?? '').toLowerCase();
  if (!correo || !config.adminsPlataforma.includes(correo)) {
    return c.json({ error: 'Solo administradores de la plataforma' }, 403);
  }
  c.set('usuarioId', data.user.id);
  c.set('correo', correo);
  await next();
});

const invalido = (c: Context, e: z.ZodError) =>
  c.json({ error: 'Datos inválidos', detalle: e.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`) }, 400);
const cuerpo = async (c: Context) => c.req.json().catch(() => ({}));

// ---------------------------------------------------------------- validación

/** Subdominios que la plataforma usa para sí misma. */
export const SUBDOMINIOS_RESERVADOS = new Set([
  'www', 'api', 'app', 'admin', 'consola', 'plataforma', 'portal', 'flujos', 'mail', 'correo', 'soporte', 'ayuda', 'demo', 'static',
]);

export function subdominioValido(s: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{1,40}[a-z0-9])$/.test(s) && !s.includes('--') && !SUBDOMINIOS_RESERVADOS.has(s);
}

/** Formato del NIT guatemalteco: dígitos y un dígito verificador (número o K). */
export function nitConFormato(nit: string): boolean {
  return /^\d{1,12}-?[\dK]$/i.test(nit.trim());
}

/**
 * Comprueba el dígito verificador del NIT con el método del módulo 11.
 * Se usa como advertencia, no como rechazo: la confirmación definitiva es
 * la constancia de RTU de la SAT.
 */
export function nitVerificadorCorrecto(nit: string): boolean {
  const limpio = nit.trim().toUpperCase().replace(/-/g, '');
  if (!/^\d{1,12}[\dK]$/.test(limpio)) return false;
  const cuerpoNit = limpio.slice(0, -1);
  const verificador = limpio.slice(-1);
  let suma = 0;
  for (let i = 0; i < cuerpoNit.length; i++) suma += Number(cuerpoNit[i]) * (cuerpoNit.length + 1 - i);
  const resultado = (11 - (suma % 11)) % 11;
  return (resultado === 10 ? 'K' : String(resultado)) === verificador;
}

const ACTIVIDADES = [
  'inmobiliaria', 'vehiculos', 'arte_joyas_metales', 'blindaje', 'servicios_societarios', 'loterias_rifas',
  'activos_virtuales', 'profesional', 'notario', 'financiera_no_supervisada', 'cooperativa', 'casa_empeno',
] as const;

export const esquemaOrganizacion = z.object({
  nombreLegal: z.string().trim().min(3, 'Indique la razón social'),
  nombreComercial: z.string().trim().min(2, 'Indique el nombre comercial'),
  nit: z.string().trim().refine(nitConFormato, 'NIT con formato inválido (ej. 1234567-8)'),
  actividad: z.enum(ACTIVIDADES).default('inmobiliaria'),
  inscripcionIve: z.string().trim().min(1).optional(),
  subdominio: z.string().trim().toLowerCase().refine(subdominioValido, 'Subdominio inválido o reservado (3 a 42 caracteres: letras minúsculas, números y guiones)'),
  marca: z.object({
    nombreVisible: z.string().trim().min(2),
    colorPrimario: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color en formato #RRGGBB').default('#0f5e5a'),
    logoUrl: z.string().url().refine((u) => u.startsWith('https://'), 'El logo debe servirse por https').optional(),
  }),
});

/** Fila de la primera metodología de una organización: la base, sin aprobar (art. 8). */
export function configuracionInicial(organizacionId: string) {
  return {
    organizacion_id: organizacionId,
    version: 1,
    parametros: configuracionBaseInmobiliaria,
    aprobada_por: null,
    aprobada_en: null,
    vigente_desde: null,
  };
}

const ROLES = ['administrador', 'ejecutivo', 'oficial', 'oficial_suplente', 'auditor'] as const;
/** Fecha de hoy en Guatemala (AAAA-MM-DD). */
export const hoyGuatemala = (ahora = new Date()) => ahora.toLocaleDateString('sv-SE', { timeZone: 'America/Guatemala' });
const fechaPasada = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((f) => f <= hoyGuatemala(), 'La fecha no puede ser futura');

// ---------------------------------------------------------------- organizaciones

apiPlataforma.post('/organizaciones', async (c) => {
  const p = esquemaOrganizacion.safeParse(await cuerpo(c));
  if (!p.success) return invalido(c, p.error);
  const d = p.data;
  const advertencias: string[] = [];
  if (!nitVerificadorCorrecto(d.nit)) advertencias.push('El dígito verificador del NIT no cuadra: confírmelo con la constancia de RTU.');
  if (!d.inscripcionIve) advertencias.push('Falta el número de inscripción ante la IVE (art. 5). La organización no podrá operar sin él.');

  const { data, error } = await db().from('organizaciones').insert({
    nombre_legal: d.nombreLegal,
    nombre_comercial: d.nombreComercial,
    nit: d.nit.toUpperCase(),
    actividad: d.actividad,
    inscripcion_ive: d.inscripcionIve ?? null,
    subdominio: d.subdominio,
    marca: { nombre_visible: d.marca.nombreVisible, color_primario: d.marca.colorPrimario, logo_url: d.marca.logoUrl ?? null },
  }).select('id').single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return c.json({ error: 'El subdominio ya está en uso' }, 409);
    return c.json({ error: error.message }, 400);
  }
  const id = (data as { id: string }).id;
  await sinError(db().from('configuraciones_riesgo').insert(configuracionInicial(id)));
  if (d.actividad !== 'inmobiliaria') {
    advertencias.push('La metodología base es la de inmobiliarias: ajústela a la actividad antes de aprobarla.');
  }
  return c.json({ id, advertencias }, 201);
});

apiPlataforma.get('/organizaciones', async (c) => {
  const filas = await sinError(db().from('estado_alta_organizaciones').select('*').order('creado_en', { ascending: false }));
  return c.json({ organizaciones: filas });
});

apiPlataforma.get('/organizaciones/:id', async (c) => {
  const id = c.req.param('id');
  const estado = await sinError(db().from('estado_alta_organizaciones').select('*').eq('id', id).maybeSingle());
  if (!estado) return c.json({ error: 'Organización no encontrada' }, 404);
  const [miembros, configuraciones, canal] = await Promise.all([
    sinError(db().from('miembros').select('usuario_id, rol, activo, creado_en').eq('organizacion_id', id).order('creado_en')),
    sinError(db().from('configuraciones_riesgo').select('id, version, aprobada_por, aprobada_en, vigente_desde, creado_en').eq('organizacion_id', id).order('version', { ascending: false })),
    sinError(db().from('canales_whatsapp').select('waba_id, phone_number_id, numero_visible, nombre_visible, estado, token_secret_id, creado_en').eq('organizacion_id', id).maybeSingle()),
  ]);
  const usuarios = await Promise.all((miembros as any[]).map(async (m) => {
    const u = await db().auth.admin.getUserById(m.usuario_id).catch(() => null);
    return { ...m, correo: u?.data?.user?.email ?? null, invitacionPendiente: !u?.data?.user?.last_sign_in_at };
  }));
  const c2 = canal as any;
  return c.json({
    estado,
    usuarios,
    configuraciones,
    // El token nunca sale de Vault; solo se informa si está guardado.
    canal: c2 ? { ...c2, token_secret_id: undefined, tokenGuardado: !!c2.token_secret_id } : null,
  });
});

apiPlataforma.patch('/organizaciones/:id', async (c) => {
  const p = z.object({
    inscripcionIve: z.string().trim().min(1).optional(),
    nombreComercial: z.string().trim().min(2).optional(),
    marca: esquemaOrganizacion.shape.marca.optional(),
  }).safeParse(await cuerpo(c));
  if (!p.success) return invalido(c, p.error);
  const cambios: Record<string, unknown> = {};
  if (p.data.inscripcionIve) cambios.inscripcion_ive = p.data.inscripcionIve;
  if (p.data.nombreComercial) cambios.nombre_comercial = p.data.nombreComercial;
  if (p.data.marca) {
    cambios.marca = { nombre_visible: p.data.marca.nombreVisible, color_primario: p.data.marca.colorPrimario, logo_url: p.data.marca.logoUrl ?? null };
  }
  if (!Object.keys(cambios).length) return c.json({ error: 'Nada que actualizar' }, 400);
  const { data, error } = await db().from('organizaciones').update(cambios).eq('id', c.req.param('id')).select('id').maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  if (!data) return c.json({ error: 'Organización no encontrada' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- usuarios

apiPlataforma.post('/organizaciones/:id/usuarios', async (c) => {
  const id = c.req.param('id');
  const p = z.object({ correo: z.string().trim().toLowerCase().email('Correo inválido'), rol: z.enum(ROLES) }).safeParse(await cuerpo(c));
  if (!p.success) return invalido(c, p.error);
  const org = await sinError(db().from('organizaciones').select('id, subdominio').eq('id', id).maybeSingle());
  if (!org) return c.json({ error: 'Organización no encontrada' }, 404);

  let usuarioId = (await sinError(db().rpc('usuario_por_correo', { p_correo: p.data.correo }))) as string | null;
  let invitado = false;
  if (!usuarioId) {
    const destino = process.env.CONSOLA_ORIGEN;
    const r = await db().auth.admin.inviteUserByEmail(p.data.correo, destino ? { redirectTo: destino } : undefined);
    if (r.error || !r.data.user) return c.json({ error: `No se pudo invitar: ${r.error?.message ?? 'sin respuesta'}` }, 502);
    usuarioId = r.data.user.id;
    invitado = true;
  }
  await sinError(db().from('miembros').upsert(
    { organizacion_id: id, usuario_id: usuarioId, rol: p.data.rol, activo: true },
    { onConflict: 'organizacion_id,usuario_id' },
  ));
  return c.json({ usuarioId, invitado }, 201);
});

apiPlataforma.post('/organizaciones/:id/usuarios/:usuario/desactivar', async (c) => {
  const { data, error } = await db().from('miembros').update({ activo: false })
    .eq('organizacion_id', c.req.param('id')).eq('usuario_id', c.req.param('usuario')).select('rol').maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  if (!data) return c.json({ error: 'Usuario no encontrado en la organización' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- metodología (art. 8)

export const esquemaAprobacion = z.object({
  organo: z.string().trim().min(3, 'Indique el órgano de dirección que aprobó'),
  fecha: fechaPasada,
  /** Referencia del acta tal como se cita, p. ej. "Acta 15-2026, punto 4". */
  acta: z.string().trim().min(1, 'Indique la referencia del acta'),
  /** Si se envían parámetros, se crea y aprueba una versión nueva con ellos. */
  parametros: z.record(z.string(), z.unknown()).optional(),
});

apiPlataforma.post('/organizaciones/:id/metodologia/aprobar', async (c) => {
  const id = c.req.param('id');
  const p = esquemaAprobacion.safeParse(await cuerpo(c));
  if (!p.success) return invalido(c, p.error);
  const aprobadaPor = `${p.data.organo} · ${p.data.acta}`;
  const ahora = new Date().toISOString();

  const versiones = (await sinError(
    db().from('configuraciones_riesgo').select('id, version, parametros, aprobada_en').eq('organizacion_id', id).order('version', { ascending: false }),
  )) as { id: string; version: number; parametros: ConfiguracionRiesgo; aprobada_en: string | null }[];

  if (p.data.parametros) {
    const nueva = { ...(p.data.parametros as unknown as ConfiguracionRiesgo), version: (versiones[0]?.version ?? 0) + 1 };
    try { validarConfiguracion(nueva); } catch (e) { return c.json({ error: (e as Error).message }, 400); }
    const fila = await sinError(db().from('configuraciones_riesgo').insert({
      organizacion_id: id, version: nueva.version, parametros: nueva, aprobada_por: aprobadaPor, aprobada_en: p.data.fecha, vigente_desde: ahora,
    }).select('id, version').single());
    return c.json({ aprobada: fila }, 201);
  }

  const pendiente = versiones.find((v) => !v.aprobada_en);
  if (!pendiente) return c.json({ error: 'No hay una versión pendiente de aprobación. Envíe parámetros para crear una nueva.' }, 409);
  try { validarConfiguracion(pendiente.parametros); } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  await sinError(db().from('configuraciones_riesgo')
    .update({ aprobada_por: aprobadaPor, aprobada_en: p.data.fecha, vigente_desde: ahora }).eq('id', pendiente.id));
  return c.json({ aprobada: { id: pendiente.id, version: pendiente.version } });
});

// ---------------------------------------------------------------- WhatsApp

const graph = (ruta: string) => `https://graph.facebook.com/${config.graphApiVersion}/${ruta}`;

/** Comprueba con la Graph API que el número existe y que el token le da acceso. */
export async function verificarNumero(phoneNumberId: string, token: string) {
  const r = await fetch(`${graph(phoneNumberId)}?fields=display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await r.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } };
  if (!r.ok) return { ok: false as const, error: json.error?.message ?? `Meta respondió ${r.status}` };
  return { ok: true as const, numero: json.display_phone_number, nombre: json.verified_name };
}

async function guardarCanal(organizacionId: string, d: { wabaId: string; phoneNumberId: string; numeroVisible: string; nombreVisible: string; token: string }) {
  const existente = await sinError(db().from('canales_whatsapp').select('organizacion_id').eq('phone_number_id', d.phoneNumberId).maybeSingle());
  if (existente && (existente as any).organizacion_id !== organizacionId) {
    return { error: 'Ese número ya está conectado a otra organización', status: 409 as const };
  }
  await sinError(db().from('canales_whatsapp').upsert({
    organizacion_id: organizacionId,
    waba_id: d.wabaId,
    phone_number_id: d.phoneNumberId,
    numero_visible: d.numeroVisible,
    nombre_visible: d.nombreVisible,
    estado: 'pendiente',
  }, { onConflict: 'organizacion_id' }));
  await sinError(db().rpc('guardar_token_canal', { p_organizacion: organizacionId, p_token: d.token }));
  const v = await verificarNumero(d.phoneNumberId, d.token);
  if (v.ok) await sinError(db().from('canales_whatsapp').update({ estado: 'activo' }).eq('organizacion_id', organizacionId));
  return { estado: v.ok ? 'activo' : 'pendiente', verificacion: v };
}

/** Conexión manual: los datos se copian del administrador de WhatsApp Business de Meta. */
apiPlataforma.post('/organizaciones/:id/whatsapp', async (c) => {
  const p = z.object({
    wabaId: z.string().regex(/^\d+$/, 'ID de la cuenta de WhatsApp Business (solo dígitos)'),
    phoneNumberId: z.string().regex(/^\d+$/, 'ID del número de teléfono (solo dígitos)'),
    numeroVisible: z.string().trim().min(8),
    nombreVisible: z.string().trim().min(2),
    token: z.string().trim().min(20, 'Token de acceso inválido'),
  }).safeParse(await cuerpo(c));
  if (!p.success) return invalido(c, p.error);
  const org = await sinError(db().from('organizaciones').select('id').eq('id', c.req.param('id')).maybeSingle());
  if (!org) return c.json({ error: 'Organización no encontrada' }, 404);
  const r = await guardarCanal(c.req.param('id'), p.data);
  if ('error' in r) return c.json({ error: r.error }, r.status);
  return c.json(r);
});

/**
 * Registro integrado de Meta (Embedded Signup) para proveedores tecnológicos.
 * La página de la plataforma abre el flujo de Meta, que devuelve un código de
 * un solo uso y los IDs de la cuenta y del número. Aquí, de servidor a
 * servidor: (1) se cambia el código por el token del negocio, (2) se suscribe
 * la app a los webhooks de la cuenta, (3) se registra el número con un PIN de
 * 6 dígitos y (4) se guarda y verifica el canal.
 */
apiPlataforma.post('/organizaciones/:id/whatsapp/registro-integrado', async (c) => {
  const p = z.object({
    code: z.string().min(10),
    wabaId: z.string().regex(/^\d+$/),
    phoneNumberId: z.string().regex(/^\d+$/),
    pin: z.string().regex(/^\d{6}$/, 'El PIN debe tener 6 dígitos'),
  }).safeParse(await cuerpo(c));
  if (!p.success) return invalido(c, p.error);
  const appId = process.env.META_APP_ID;
  if (!appId) return c.json({ error: 'Falta META_APP_ID en el servidor' }, 500);
  const org = await sinError(db().from('organizaciones').select('id, nombre_comercial').eq('id', c.req.param('id')).maybeSingle());
  if (!org) return c.json({ error: 'Organización no encontrada' }, 404);

  const q = new URLSearchParams({ client_id: appId, client_secret: config.metaAppSecret, code: p.data.code });
  const r1 = await fetch(`${graph('oauth/access_token')}?${q}`);
  const t1 = await r1.text();
  let token: string | undefined;
  try { token = (JSON.parse(t1) as { access_token?: string }).access_token; } catch { token = t1.trim() || undefined; }
  if (!r1.ok || !token) return c.json({ error: 'Meta no entregó el token del negocio', detalle: [t1.slice(0, 300)] }, 502);

  const autorizado = { Authorization: `Bearer ${token}` };
  const r2 = await fetch(graph(`${p.data.wabaId}/subscribed_apps`), { method: 'POST', headers: autorizado });
  if (!r2.ok) return c.json({ error: 'No se pudo suscribir la app a los webhooks de la cuenta', detalle: [(await r2.text()).slice(0, 300)] }, 502);

  const r3 = await fetch(graph(`${p.data.phoneNumberId}/register`), {
    method: 'POST',
    headers: { ...autorizado, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin: p.data.pin }),
  });
  if (!r3.ok) return c.json({ error: 'No se pudo registrar el número', detalle: [(await r3.text()).slice(0, 300)] }, 502);

  const info = await verificarNumero(p.data.phoneNumberId, token);
  const r = await guardarCanal(c.req.param('id'), {
    wabaId: p.data.wabaId,
    phoneNumberId: p.data.phoneNumberId,
    numeroVisible: info.ok ? info.numero ?? '' : '',
    nombreVisible: info.ok ? info.nombre ?? (org as any).nombre_comercial : (org as any).nombre_comercial,
    token,
  });
  if ('error' in r) return c.json({ error: r.error }, r.status);
  return c.json(r);
});

// ---------------------------------------------------------------- listas GAFI y avisos

apiPlataforma.get('/listas-gafi', async (c) => {
  const filas = await sinError(db().from('listas_gafi')
    .select('id, plenario, alto_riesgo, monitoreo, fuente_alto_riesgo, fuente_monitoreo, cargada_por, cargada_en')
    .order('plenario', { ascending: false }).limit(12));
  return c.json({ listas: filas });
});

apiPlataforma.get('/avisos', async (c) => {
  const filas = await sinError(db().from('avisos_plataforma').select('*').order('creado_en', { ascending: false }).limit(100));
  return c.json({ avisos: filas });
});

apiPlataforma.post('/avisos/:id/atender', async (c) => {
  const { data, error } = await db().from('avisos_plataforma').update({ atendido_en: new Date().toISOString() })
    .eq('id', c.req.param('id')).is('atendido_en', null).select('id').maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  if (!data) return c.json({ error: 'Aviso no encontrado o ya atendido' }, 409);
  return c.json({ ok: true });
});
