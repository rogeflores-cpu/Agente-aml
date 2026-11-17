import { createClient } from '@supabase/supabase-js';
import type { DetalleExpediente, FilaOperacion, Fuente } from './tipos';

/**
 * Fuente real: lecturas directas contra Supabase (aplican las políticas por
 * rol) y acciones por la API del servidor, con el token de la sesión.
 */
export function fuenteSupabase(): Fuente {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const api = (import.meta.env.VITE_API_URL as string) ?? '';
  if (!url || !anon) throw new Error('Configure VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY');
  const sb = createClient(url, anon, { db: { schema: 'aml' } });

  const leer = async <T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> => {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return data as T;
  };

  const llamar = async (ruta: string, cuerpo?: unknown, metodo = 'POST', prefijo = '/api/consola') => {
    const { data } = await sb.auth.getSession();
    const r = await fetch(`${api}${prefijo}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error([json.error, ...(json.detalle ?? [])].filter(Boolean).join(' · ') || `Error ${r.status}`);
    return json;
  };

  return {
    modoDemo: false,

    async sesion() {
      const { data } = await sb.auth.getSession();
      const u = data.session?.user;
      return u ? { usuarioId: u.id, correo: u.email ?? '' } : null;
    },
    async iniciarSesion(correo, clave) {
      const { error } = await sb.auth.signInWithPassword({ email: correo, password: clave });
      if (error) throw new Error('Correo o contraseña incorrectos');
    },
    async cerrarSesion() {
      await sb.auth.signOut();
    },

    async organizaciones() {
      return leer(sb.from('mis_organizaciones').select('id, nombre, rol').order('nombre'));
    },

    async bandeja(org) {
      const filas = await leer<any[]>(sb.from('bandeja_cumplimiento').select('*').eq('organizacion_id', org).order('actualizado_en', { ascending: false }));
      return filas.map((f) => ({
        id: f.id, codigoOperacion: f.codigo_operacion, parte: f.parte, tipoPersona: f.tipo_persona, nombre: f.nombre,
        estado: f.estado, nivel: f.nivel, pendientes: Number(f.pendientes), coincidenciasSinDisponer: Number(f.coincidencias_sin_disponer),
        alertasAbiertas: Number(f.alertas_abiertas), actualizadoEn: f.actualizado_en,
      }));
    },

    async expediente(id): Promise<DetalleExpediente> {
      const [e, datos, documentos, pendientes, verificaciones, alertas, evaluaciones, decisiones, bitacora] = await Promise.all([
        leer<any>(sb.from('expedientes').select('*, operaciones(codigo, tipo, precio, moneda, inmueble, forma_pago)').eq('id', id).single()),
        leer<any[]>(sb.from('datos_expediente').select('campo, valor, origen, documento_id, pagina, confianza, confirmado_en').eq('expediente_id', id).eq('vigente', true).order('campo')),
        leer<any[]>(sb.from('documentos').select('id, tipo, estado, canal, sha256, creado_en').eq('expediente_id', id).order('creado_en')),
        leer<any[]>(sb.from('pendientes').select('id, tipo, descripcion, estado').eq('expediente_id', id).eq('estado', 'abierto')),
        leer<any[]>(sb.from('verificaciones').select('*').eq('expediente_id', id).order('consultado_en', { ascending: false })),
        leer<any[]>(sb.from('alertas').select('*').eq('expediente_id', id).order('creado_en', { ascending: false })),
        leer<any[]>(sb.from('evaluaciones_riesgo').select('*').eq('expediente_id', id).order('calculado_en', { ascending: false })),
        leer<any[]>(sb.from('decisiones').select('*').eq('expediente_id', id).order('decidido_en', { ascending: false })),
        leer<any[]>(sb.from('bitacora').select('id, ocurrido_en, actor_tipo, evento, entidad, hash').eq('entidad_id', id).order('id', { ascending: false }).limit(100)),
      ]);
      return {
        id: e.id, organizacionId: e.organizacion_id, codigoOperacion: e.operaciones.codigo, parte: e.parte, tipoPersona: e.tipo_persona,
        estado: e.estado, verificacionDiferidaHasta: e.verificacion_diferida_hasta,
        contacto: { nombre: e.contacto_nombre, telefono: e.contacto_telefono, correo: e.contacto_correo, whatsappVinculado: !!e.whatsapp_vinculado_en },
        operacion: { tipo: e.operaciones.tipo, precio: e.operaciones.precio, moneda: e.operaciones.moneda, inmueble: e.operaciones.inmueble ?? {}, formaPago: e.operaciones.forma_pago ?? [] },
        datos: datos.map((d) => ({ campo: d.campo, valor: d.valor, origen: d.origen, documentoId: d.documento_id, pagina: d.pagina, confianza: d.confianza, confirmado: !!d.confirmado_en })),
        documentos: documentos.map((d) => ({ id: d.id, tipo: d.tipo, estado: d.estado, canal: d.canal, sha256: d.sha256, creadoEn: d.creado_en })),
        pendientes,
        verificaciones: verificaciones.map((v) => ({
          id: v.id, nombreConsultado: v.nombre_consultado, fuente: v.fuente, versionFuente: v.version_fuente, consultadoEn: v.consultado_en,
          resultado: v.resultado, coincidencias: v.coincidencias ?? [], justificacion: v.justificacion, dispuestoEn: v.dispuesto_en,
        })),
        alertas: alertas.map((a) => ({ id: a.id, senal: a.senal, descripcion: a.descripcion, estado: a.estado, venceEn: a.vence_en, creadoEn: a.creado_en, cierre: a.cierre })),
        evaluaciones: evaluaciones.map((v) => ({
          id: v.id, calculadoEn: v.calculado_en, puntajes: v.puntajes, puntajeTotal: Number(v.puntaje_total), nivelCalculado: v.nivel_calculado,
          nivelAjustado: v.nivel_ajustado, justificacionAjuste: v.justificacion_ajuste, medidas: v.medidas, reglas: v.reglas_impuestas, senales: v.senales,
        })),
        decisiones: decisiones.map((d) => ({ id: d.id, tipo: d.tipo, justificacion: d.justificacion, condiciones: d.condiciones, decididoEn: d.decidido_en, decididoPor: d.decidido_por })),
        bitacora: bitacora.map((b) => ({ id: b.id, ocurridoEn: b.ocurrido_en, actorTipo: b.actor_tipo, evento: b.evento, entidad: b.entidad, hash: b.hash })),
      };
    },

    async avisos(org) {
      const filas = await leer<any[]>(sb.from('notificaciones').select('*').eq('organizacion_id', org).order('creada_en', { ascending: false }).limit(50));
      return filas.map((n) => ({ id: n.id, asunto: n.asunto, cuerpo: n.cuerpo, prioridad: n.prioridad, expedienteId: n.expediente_id, creadaEn: n.creada_en, leida: !!n.leida_en }));
    },
    async marcarLeido(id) {
      await leer(sb.from('notificaciones').update({ leida_en: new Date().toISOString() }).eq('id', id));
    },

    async evaluar(id, ajustes) {
      const r = await llamar(`/expedientes/${id}/evaluar`, ajustes);
      return { advertencias: r.advertencias ?? [] };
    },
    async disponer(id, resultado, justificacion) {
      await llamar(`/verificaciones/${id}/disponer`, { resultado, justificacion });
    },
    async decidir(id, d) {
      await llamar(`/expedientes/${id}/decidir`, d);
    },
    async cerrarAlerta(id, cierre) {
      await llamar(`/alertas/${id}/cerrar`, { cierre });
    },
    async urlDocumento(id) {
      const r = await llamar(`/documentos/${id}/url`, undefined, 'GET');
      return r.url ?? null;
    },

    // Vista operativa: solo la vista enmascarada aml.operaciones_comercial (art. 38).
    async operaciones(org) {
      const filas = await leer<any[]>(sb.from('operaciones_comercial').select('*').eq('organizacion_id', org)
        .order('operacion_creada_en', { ascending: false }));
      const porId = new Map<string, FilaOperacion>();
      for (const f of filas) {
        const op: FilaOperacion = porId.get(f.operacion_id) ?? {
          id: f.operacion_id, codigo: f.codigo, tipo: f.tipo, precio: f.precio == null ? null : Number(f.precio),
          moneda: f.moneda, inmueble: f.inmueble ?? {}, creadaEn: f.operacion_creada_en, partes: [],
        };
        op.partes.push({
          expedienteId: f.expediente_id, parte: f.parte, tipoPersona: f.tipo_persona, nombre: f.contacto_nombre,
          telefono: f.contacto_telefono, correo: f.contacto_correo, estado: f.estado, pendientes: Number(f.pendientes),
          whatsappVinculado: f.whatsapp_vinculado, actualizadoEn: f.actualizado_en,
        });
        porId.set(f.operacion_id, op);
      }
      return [...porId.values()];
    },
    async registrarOperacion(org, op) {
      const r = await llamar('/operaciones', { organizacionId: org, ...op }, 'POST', '/api/operaciones');
      return { codigo: r.codigo };
    },
    async reenviarEnlace(id) {
      return llamar(`/expedientes/${id}/reenviar-enlace`, {}, 'POST', '/api/operaciones');
    },
    async registrarPagoEfectivo(p) {
      await llamar('/pagos-efectivo', p, 'POST', '/api/operaciones');
    },
  };
}
