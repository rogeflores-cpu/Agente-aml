import { aplicarListaGafi, evaluar, type ConfiguracionRiesgo } from '@agente-aml/riesgo';
import { createClient } from '@supabase/supabase-js';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { inngest } from './cliente-inngest.js';
import { config } from './config.js';
import { db, notificar, sinError } from './datos.js';
import { construirPerfil } from './perfil.js';
import { personasIdentificadas } from '@agente-aml/agente';
import { cotejosPendientes } from './cotejos.js';
import {
  ajustePermitido, correoVerificado, evaluacionVigente, mismaPersona, nivelMinimoImpuesto, normalizarDocumento, plenarioValido,
} from './reglas-consola.js';
import { cargarEntradaRevision } from './repositorio.js';

/**
 * API de la consola de cumplimiento. Las lecturas las hace la consola
 * directamente contra Supabase (con sus permisos por rol). Aquí quedan las
 * acciones que necesitan lógica del servidor o disparan flujos:
 * evaluar riesgo, disponer coincidencias, decidir, cerrar alertas y cargar
 * las listas del GAFI. Las escrituras sensibles se hacen con el token del
 * usuario, de modo que las políticas y disparadores de la base las validan.
 */
type Vars = { usuarioId: string; correo: string; correoVerificado: boolean; token: string };
export const apiConsola = new Hono<{ Variables: Vars }>();

apiConsola.use('*', cors({ origin: (o) => (o === config.consolaOrigen ? o : null), allowHeaders: ['Authorization', 'Content-Type'] }));

apiConsola.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next();
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return c.json({ error: 'Sesión requerida' }, 401);
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) return c.json({ error: 'Sesión inválida' }, 401);
  c.set('usuarioId', data.user.id);
  c.set('correo', (data.user.email ?? '').toLowerCase());
  c.set('correoVerificado', correoVerificado(data.user));
  c.set('token', token);
  await next();
});

/** Cliente de Supabase que actúa como el usuario: aplican RLS y disparadores. */
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

async function expedienteDe(id: string) {
  return (await sinError(
    db().from('expedientes').select('id, organizacion_id, operacion_id, cliente_id, parte, tipo_persona, estado').eq('id', id).maybeSingle(),
  )) as { id: string; organizacion_id: string; operacion_id: string; cliente_id: string | null; parte: string; tipo_persona: string; estado: string } | null;
}

/** Exige que el usuario sea oficial (titular o suplente) de la organización del expediente. */
async function exigirOficial(c: Context<{ Variables: Vars }>, expedienteId: string) {
  const exp = await expedienteDe(expedienteId);
  if (!exp) return { error: c.json({ error: 'Expediente no encontrado' }, 404) };
  const rol = await rolEn(exp.organizacion_id, c.get('usuarioId'));
  if (!rol) return { error: c.json({ error: 'Expediente no encontrado' }, 404) }; // B5: no revelar que existe en otra organización
  if (rol !== 'oficial' && rol !== 'oficial_suplente') return { error: c.json({ error: 'Solo el oficial de cumplimiento' }, 403) };
  return { exp };
}

const invalido = (c: Context, e: z.ZodError) => c.json({ error: 'Datos inválidos', detalle: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400);

/**
 * Crea o vincula el registro de cliente a partir de los datos del expediente.
 * M3: si ya existe una ficha con el mismo documento, solo se vincula cuando el
 * nombre también coincide; nunca se sobrescribe la ficha de otra persona. Si
 * no coincide, se avisa a cumplimiento y el expediente queda sin ficha.
 */
async function asegurarCliente(expedienteId: string): Promise<string | null> {
  const existente = await expedienteDe(expedienteId);
  if (existente?.cliente_id) return existente.cliente_id;
  const e = await cargarEntradaRevision(expedienteId);
  const v = (k: string) => e.datos[k]?.valor as string | undefined;
  const individual = e.contexto.tipoPersona === 'individual';
  const nombre = individual ? v('cliente.nombre_completo') : v('entidad.razon_social');
  const idTipo = individual ? v('cliente.documento_tipo') : 'NIT';
  const idNum = individual ? v('cliente.documento_numero') : v('entidad.nit');
  if (!nombre || !idTipo || !idNum) return null;
  const doc = normalizarDocumento(String(idTipo), String(idNum));
  const ficha = (await sinError(
    db().from('clientes').select('id, nombre').eq('organizacion_id', e.base.organizacion_id)
      .eq('identificacion_tipo', doc.tipo).eq('identificacion_num', doc.numero).maybeSingle(),
  )) as { id: string; nombre: string } | null;
  let id: string;
  if (ficha) {
    if (!mismaPersona(ficha.nombre, nombre, !individual)) {
      await notificar(e.base.organizacion_id, 'cumplimiento', 'Documento ya registrado con otro nombre',
        `El expediente declara el documento ${doc.tipo} ${doc.numero} a nombre de "${nombre}", pero la ficha existente es de "${ficha.nombre}". No se vinculó: revise la identidad.`,
        { expedienteId, prioridad: 'alta' });
      return null;
    }
    id = ficha.id;
  } else {
    const nueva = await sinError(db().from('clientes').insert({
      organizacion_id: e.base.organizacion_id,
      tipo_persona: e.contexto.tipoPersona,
      nombre,
      identificacion_tipo: doc.tipo,
      identificacion_num: doc.numero,
      datos: Object.fromEntries(Object.entries(e.datos).filter(([k]) => !k.startsWith('doc.')).map(([k, d]) => [k, d.valor])),
    }).select('id').single());
    id = (nueva as { id: string }).id;
  }
  await sinError(db().from('expedientes').update({ cliente_id: id }).eq('id', expedienteId));
  return id;
}

// ---------------------------------------------------------------- evaluar
const esquemaAjustes = z.object({
  presencial: z.boolean().optional(),
  intermediario: z.boolean().optional(),
  actuaPorRepresentacion: z.boolean().optional(),
  contratistaOProveedorEstado: z.boolean().optional(),
  noDomiciliado: z.boolean().optional(),
  nivelesPropiedad: z.number().int().min(1).optional(),
  coherenciaPerfilMonto: z.enum(['coherente', 'dudosa', 'incoherente']).optional(),
  transaccionInusual: z.boolean().optional(),
  diasDesdeAdquisicion: z.number().int().min(0).optional(),
  nacionalidad: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  paisResidencia: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  tipoCambioUsd: z.number().positive().optional(),
});

apiConsola.post('/expedientes/:id/evaluar', async (c) => {
  const { exp, error } = await exigirOficial(c, c.req.param('id'));
  if (error) return error;
  const ajustes = esquemaAjustes.safeParse(await c.req.json().catch(() => ({})));
  if (!ajustes.success) return invalido(c, ajustes.error);

  const [entrada, operacion, verificaciones, configFila, gafi] = await Promise.all([
    cargarEntradaRevision(exp.id),
    sinError(db().from('operaciones').select('tipo, precio, moneda, valor_referencia, inmueble, forma_pago').eq('id', exp.operacion_id).single()),
    sinError(db().from('verificaciones').select('fuente, resultado').eq('expediente_id', exp.id)),
    sinError(db().from('configuraciones_riesgo').select('id, parametros').eq('organizacion_id', exp.organizacion_id)
      .not('aprobada_en', 'is', null).order('version', { ascending: false }).limit(1).maybeSingle()),
    sinError(db().from('lista_gafi_vigente').select('plenario, alto_riesgo, monitoreo').maybeSingle()),
  ]);
  if (!configFila) return c.json({ error: 'La organización no tiene una metodología de riesgo aprobada (art. 8).' }, 409);
  if (!gafi) return c.json({ error: 'No hay listas del GAFI cargadas en la plataforma.' }, 409);

  let construido;
  try {
    construido = construirPerfil(entrada, operacion as any, verificaciones as any, ajustes.data);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  const g = gafi as { plenario: string; alto_riesgo: string[]; monitoreo: string[] };
  const configuracion = aplicarListaGafi((configFila as any).parametros as ConfiguracionRiesgo, {
    plenario: g.plenario, altoRiesgo: g.alto_riesgo, monitoreo: g.monitoreo,
  });
  const r = evaluar(construido.perfil, configuracion);
  await asegurarCliente(exp.id);

  const fila = await sinError(db().from('evaluaciones_riesgo').insert({
    organizacion_id: exp.organizacion_id,
    expediente_id: exp.id,
    configuracion_id: (configFila as any).id,
    entrada: { perfil: construido.perfil, ajustes: ajustes.data, listaGafi: g.plenario, evaluadoPor: c.get('usuarioId') },
    puntajes: r.puntajes,
    puntaje_total: r.puntajeTotal,
    nivel_calculado: r.nivel,
    medidas: r.medidas,
    reglas_impuestas: r.reglas,
    senales: r.senales,
  }).select('id').single());

  // Las señales de alerta del sector quedan como alertas para análisis (art. 28), sin duplicar las abiertas (B4)
  if (r.senales.length) {
    const abiertas = (await sinError(
      db().from('alertas').select('senal').eq('expediente_id', exp.id).neq('estado', 'cerrada'),
    )) as { senal: string }[];
    const ya = new Set(abiertas.map((a) => a.senal));
    const nuevas = r.senales.filter((s) => !ya.has(s.codigo));
    if (nuevas.length) {
      await sinError(db().from('alertas').insert(nuevas.map((s) => ({
        organizacion_id: exp.organizacion_id, expediente_id: exp.id, senal: s.codigo, descripcion: s.descripcion, evidencia: s.evidencia ?? {},
      }))));
    }
  }
  return c.json({ evaluacionId: (fila as any).id, resultado: r, advertencias: construido.advertencias });
});

// ---------------------------------------------------------- ajustar nivel
apiConsola.post('/evaluaciones/:id/ajustar', async (c) => {
  const cuerpo = z.object({ nivel: z.enum(['bajo', 'medio', 'alto']), justificacion: z.string().min(20) }).safeParse(await c.req.json().catch(() => ({})));
  if (!cuerpo.success) return invalido(c, cuerpo.error);
  // M1: no se puede bajar el nivel por debajo de lo que imponen las reglas (ONU, PEP, GAFI)
  const { data: ev } = await comoUsuario(c).from('evaluaciones_riesgo')
    .select('reglas_impuestas, nivel_ajustado').eq('id', c.req.param('id')).maybeSingle();
  if (!ev) return c.json({ error: 'Evaluación no encontrada' }, 404);
  if ((ev as any).nivel_ajustado) return c.json({ error: 'La evaluación ya fue ajustada. Calcule una nueva evaluación para volver a ajustar.' }, 409);
  if (!ajustePermitido(cuerpo.data.nivel, (ev as any).reglas_impuestas)) {
    return c.json({ error: `Las reglas aplicadas imponen un nivel mínimo ${nivelMinimoImpuesto((ev as any).reglas_impuestas)}.` }, 409);
  }
  const { error } = await comoUsuario(c).from('evaluaciones_riesgo')
    .update({ nivel_ajustado: cuerpo.data.nivel, justificacion_ajuste: cuerpo.data.justificacion, ajustado_por: c.get('usuarioId') })
    .eq('id', c.req.param('id'));
  if (error) return c.json({ error: error.message }, 403);
  return c.json({ ok: true });
});

// ------------------------------------------------- disponer coincidencias
apiConsola.post('/verificaciones/:id/disponer', async (c) => {
  const cuerpo = z.object({
    resultado: z.enum(['descartada', 'coincidencia_confirmada']),
    justificacion: z.string().min(20, 'Justifique con al menos 20 caracteres'),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!cuerpo.success) return invalido(c, cuerpo.error);
  const ahora = new Date().toISOString();
  const { data, error } = await comoUsuario(c).from('verificaciones')
    .update({ resultado: cuerpo.data.resultado, justificacion: cuerpo.data.justificacion, dispuesto_por: c.get('usuarioId'), dispuesto_en: ahora })
    .eq('id', c.req.param('id')).eq('resultado', 'posible_coincidencia')
    .select('id, organizacion_id, expediente_id').maybeSingle();
  if (error) return c.json({ error: error.message }, 403);
  if (!data) return c.json({ error: 'La verificación no existe o ya fue dispuesta' }, 409);
  await inngest.send({
    name: 'aml/verificacion.dispuesta',
    data: { organizacionId: data.organizacion_id, verificacionId: data.id, resultado: cuerpo.data.resultado },
  });
  if (cuerpo.data.resultado === 'coincidencia_confirmada') {
    await inngest.send({
      name: 'aml/onu.coincidencia_confirmada',
      data: { organizacionId: data.organizacion_id, expedienteId: data.expediente_id, verificacionId: data.id, confirmadaEn: ahora },
    });
  }
  return c.json({ ok: true });
});

// ----------------------------------------------------------------- decidir
const esquemaDecision = z.object({
  tipo: z.enum(['aprobar', 'aprobar_diferida', 'intensificar', 'rechazar', 'abstener', 'abrir_examen']),
  justificacion: z.string().min(20, 'Justifique con al menos 20 caracteres'),
  condiciones: z.string().optional(),
  verificacionDiferidaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  evaluacionId: z.string().uuid().optional(),
});

apiConsola.post('/expedientes/:id/decidir', async (c) => {
  const { exp, error } = await exigirOficial(c, c.req.param('id'));
  if (error) return error;
  const cuerpo = esquemaDecision.safeParse(await c.req.json().catch(() => ({})));
  if (!cuerpo.success) return invalido(c, cuerpo.error);
  const d = cuerpo.data;
  const aprueba = d.tipo === 'aprobar' || d.tipo === 'aprobar_diferida';

  let evaluacion: { id: string; nivel: string } | null = null;
  if (aprueba) {
    const ev = await sinError(db().from('evaluaciones_riesgo').select('id, nivel_calculado, nivel_ajustado, calculado_en')
      .eq('expediente_id', exp.id).order('calculado_en', { ascending: false }).limit(1).maybeSingle());
    if (!ev) return c.json({ error: 'Evalúe el riesgo antes de aprobar.' }, 409);
    evaluacion = { id: (ev as any).id, nivel: (ev as any).nivel_ajustado ?? (ev as any).nivel_calculado };

    // A1: toda persona identificada debe tener cotejo ONU con la versión vigente de la lista
    const [entrada, version, verificaciones, ultimoDato, ultimoDoc] = await Promise.all([
      cargarEntradaRevision(exp.id),
      sinError(db().from('lista_onu_versiones').select('sha256').order('cargada_en', { ascending: false }).limit(1).maybeSingle()),
      sinError(db().from('verificaciones').select('nombre_consultado, version_fuente').eq('expediente_id', exp.id).eq('fuente', 'onu')),
      sinError(db().from('datos_expediente').select('creado_en').eq('expediente_id', exp.id).order('creado_en', { ascending: false }).limit(1).maybeSingle()),
      sinError(db().from('documentos').select('creado_en').eq('expediente_id', exp.id).order('creado_en', { ascending: false }).limit(1).maybeSingle()),
    ]);
    const sha = (version as { sha256?: string } | null)?.sha256 ?? null;
    if (!sha) return c.json({ error: 'No hay lista ONU cargada: no se puede aprobar sin cotejo (art. 43).' }, 409);
    const personas = personasIdentificadas(entrada.contexto, entrada.datos);
    if (!personas.length) return c.json({ error: 'El expediente no tiene personas identificadas para cotejar.' }, 409);
    const faltan = cotejosPendientes(personas, verificaciones as any[], sha);
    if (faltan.length) {
      return c.json({ error: `Falta el cotejo con la lista ONU vigente de: ${faltan.map((p) => p.nombre).join(', ')}. Espere unos minutos e intente de nuevo.` }, 409);
    }
    // M4: la evaluación debe ser posterior al último cambio del expediente
    const cambios = [(ultimoDato as any)?.creado_en, (ultimoDoc as any)?.creado_en].filter(Boolean).sort();
    if (!evaluacionVigente((ev as any).calculado_en, cambios.at(-1))) {
      return c.json({ error: 'El expediente cambió después de la última evaluación. Vuelva a calcular el riesgo antes de aprobar.' }, 409);
    }
  }

  const { error: e } = await comoUsuario(c).from('decisiones').insert({
    organizacion_id: exp.organizacion_id,
    expediente_id: exp.id,
    evaluacion_id: d.evaluacionId ?? evaluacion?.id ?? null,
    tipo: d.tipo,
    condiciones: d.condiciones ?? null,
    verificacion_diferida_hasta: d.verificacionDiferidaHasta ?? null,
    justificacion: d.justificacion,
    decidido_por: c.get('usuarioId'),
  });
  if (e) return c.json({ error: e.message }, e.code === '42501' ? 403 : 409);

  if (aprueba && evaluacion) {
    const clienteId = await asegurarCliente(exp.id);
    if (clienteId) {
      const conf = await sinError(db().from('configuraciones_riesgo').select('parametros').eq('organizacion_id', exp.organizacion_id)
        .not('aprobada_en', 'is', null).order('version', { ascending: false }).limit(1).single());
      const meses = (conf as any).parametros?.actualizacionMeses?.[evaluacion.nivel] ?? 12;
      const proxima = new Date();
      proxima.setMonth(proxima.getMonth() + meses);
      await sinError(db().from('clientes').update({ nivel_riesgo: evaluacion.nivel, proxima_actualizacion: proxima.toISOString().slice(0, 10) }).eq('id', clienteId));
    }
  }
  if (d.tipo === 'aprobar_diferida' && d.verificacionDiferidaHasta) {
    await inngest.send({ name: 'aml/expediente.aprobado_diferido', data: { organizacionId: exp.organizacion_id, expedienteId: exp.id, hasta: d.verificacionDiferidaHasta } });
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------- cerrar alerta
apiConsola.post('/alertas/:id/cerrar', async (c) => {
  const cuerpo = z.object({ cierre: z.string().min(20, 'Describa el cierre con al menos 20 caracteres') }).safeParse(await c.req.json().catch(() => ({})));
  if (!cuerpo.success) return invalido(c, cuerpo.error);
  const { data, error } = await comoUsuario(c).from('alertas')
    .update({ estado: 'cerrada', cierre: cuerpo.data.cierre, cerrada_en: new Date().toISOString(), responsable: c.get('usuarioId') })
    .eq('id', c.req.param('id')).neq('estado', 'cerrada').select('id, organizacion_id').maybeSingle();
  if (error) return c.json({ error: error.message }, 403);
  if (!data) return c.json({ error: 'La alerta no existe o ya está cerrada' }, 409);
  await inngest.send({ name: 'aml/alerta.cerrada', data: { organizacionId: data.organizacion_id, alertaId: data.id } });
  return c.json({ ok: true });
});

// -------------------------------------------------- documento (enlace temporal)
apiConsola.get('/documentos/:id/url', async (c) => {
  const { data, error } = await comoUsuario(c).from('documentos').select('ruta_storage').eq('id', c.req.param('id')).maybeSingle();
  if (error || !data) return c.json({ error: 'Documento no disponible' }, 404);
  const firmado = await db().storage.from('expedientes').createSignedUrl(data.ruta_storage, 300);
  if (firmado.error) return c.json({ error: firmado.error.message }, 500);
  return c.json({ url: firmado.data.signedUrl, expiraEnSegundos: 300 });
});

// --------------------------------------------- listas GAFI (administración)
const iso = z.string().regex(/^[A-Za-z]{2}$/).transform((x) => x.toUpperCase());
apiConsola.post('/plataforma/listas-gafi', async (c) => {
  if (!config.adminsPlataforma.includes(c.get('correo')) || !c.get('correoVerificado')) {
    return c.json({ error: 'Solo administradores de la plataforma con correo verificado' }, 403);
  }
  const cuerpo = z.object({
    plenario: z.string().refine((x) => plenarioValido(x), 'La fecha del pleno no puede ser futura'),
    altoRiesgo: z.array(iso),
    monitoreo: z.array(iso),
    fuenteAltoRiesgo: z.string().url(),
    fuenteMonitoreo: z.string().url(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!cuerpo.success) return invalido(c, cuerpo.error);
  const d = cuerpo.data;
  const { error } = await db().from('listas_gafi').insert({
    plenario: d.plenario, alto_riesgo: d.altoRiesgo, monitoreo: d.monitoreo,
    fuente_alto_riesgo: d.fuenteAltoRiesgo, fuente_monitoreo: d.fuenteMonitoreo, cargada_por: c.get('correo'),
  });
  if (error) return c.json({ error: error.message }, 409);
  return c.json({ ok: true });
});
