import { createHash } from 'node:crypto';
import {
  atenderTurno,
  clienteClaude,
  terminoReservado,
  type PuertoExpediente,
  type Turno,
  type VistaCliente,
} from '@agente-aml/agente';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { inngest } from './cliente-inngest.js';
import { db, sinError } from './datos.js';
import { procesarDocumento } from './documentos-entrantes.js';
import { nuevoCodigoVinculacion } from './enlaces.js';
import { crearPuerto } from './repositorio.js';

/**
 * API del portal web del cliente.
 *
 * El cliente no tiene usuario: se identifica con el token de su enlace, que
 * llega solo en la cabecera `Authorization: Enlace <token>` (nunca en la URL de
 * la API, para que no quede en bitácoras de servidores intermedios). En la base
 * solo existe el hash SHA-256 del token.
 *
 * Art. 38: todo lo que sale hacia el cliente es la VistaCliente neutra, las
 * respuestas del agente (ya revisadas) y mensajes de error genéricos.
 */

export const MAX_DOCUMENTO_BYTES = 10 * 1024 * 1024;
export const MIME_DOCUMENTO = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{43}$/;
const ERROR_GENERICO = 'No pudimos procesar su solicitud. Intente de nuevo en unos minutos.';

export interface Marca {
  nombreVisible: string;
  colorPrimario: string;
  logoUrl: string | null;
}

export interface ExpedienteEnlace {
  expedienteId: string;
  organizacionId: string;
  vigente: boolean;
  marca: Marca;
}

/** Lo que la API necesita del resto del sistema. Se inyecta para poder probarla sin base de datos. */
export interface DependenciasPortal {
  buscarPorEnlace(tokenHash: string): Promise<ExpedienteEnlace | null>;
  puerto(expedienteId: string): PuertoExpediente;
  historial(expedienteId: string): Promise<Turno['historial']>;
  guardarMensaje(e: ExpedienteEnlace, direccion: 'entrante' | 'saliente', texto: string, tipo?: string): Promise<void>;
  atender(puerto: PuertoExpediente, turno: Turno): ReturnType<typeof atenderTurno>;
  procesarDocumento(expedienteId: string, archivo: { bytes: Buffer; mime: string; pista?: string }): Promise<{ nota: string }>;
  guardarCodigoWhatsapp(expedienteId: string, hash: string, expiraEn: string): Promise<void>;
  numeroWhatsapp(organizacionId: string): Promise<string | null>;
  avisarReemplazo(e: ExpedienteEnlace): Promise<void>;
}

type Vars = { enlace: ExpedienteEnlace; tokenHash: string };

/** Límite simple por token: ventana deslizante en memoria (una instancia del servidor). */
export class Limitador {
  private registros = new Map<string, number[]>();
  constructor(private maximo: number, private ventanaMs: number) {}
  permitir(clave: string, ahora = Date.now()): boolean {
    const recientes = (this.registros.get(clave) ?? []).filter((t) => ahora - t < this.ventanaMs);
    if (recientes.length >= this.maximo) {
      this.registros.set(clave, recientes);
      return false;
    }
    recientes.push(ahora);
    this.registros.set(clave, recientes);
    return true;
  }
}

/** Revisa los primeros bytes: el tipo declarado por el navegador no basta. */
export function tipoReal(bytes: Uint8Array): (typeof MIME_DOCUMENTO)[number] | null {
  const b = (i: number) => bytes[i];
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return 'application/pdf';
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.slice(i, i + n));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  return null;
}

/** Quita de la vista cualquier texto que no pase la regla de neutralidad. */
export function vistaSegura(v: VistaCliente): Omit<VistaCliente, 'contexto'> & { parte: string } {
  return {
    nombreOrganizacion: v.nombreOrganizacion,
    nombreCliente: v.nombreCliente,
    parte: v.contexto.parte,
    estado: terminoReservado(v.estado) ? 'En revisión' : v.estado,
    datos: v.datos,
    documentos: v.documentos,
    pendientes: v.pendientes.map((p) =>
      terminoReservado(p.descripcion) ? { tipo: 'aclaracion', descripcion: 'Información adicional pendiente' } : p,
    ),
  };
}

export function origenPermitido(origen: string, dominio: string | undefined): boolean {
  if (/^http:\/\/localhost(:\d+)?$/.test(origen) || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origen)) return true;
  if (!dominio) return false;
  const d = dominio.replace(/\./g, '\\.');
  return new RegExp(`^https://[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?\\.${d}$`).test(origen);
}

export function crearApiPortal(dep: DependenciasPortal, opciones: { limiteMinuto?: number; limiteDocumentosHora?: number } = {}) {
  const general = new Limitador(opciones.limiteMinuto ?? 30, 60_000);
  const documentos = new Limitador(opciones.limiteDocumentosHora ?? 20, 3_600_000);
  const app = new Hono<{ Variables: Vars }>();

  app.use('*', cors({
    origin: (o) => (origenPermitido(o, process.env.PORTAL_DOMINIO) ? o : null),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }));

  app.use('*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const token = c.req.header('authorization')?.match(/^Enlace\s+(\S+)$/i)?.[1];
    if (!token || !TOKEN_VALIDO.test(token)) return c.json({ error: 'Enlace no válido' }, 401);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    if (!general.permitir(tokenHash)) return c.json({ error: 'Demasiadas solicitudes. Espere un momento.' }, 429);
    let enlace: ExpedienteEnlace | null;
    try {
      enlace = await dep.buscarPorEnlace(tokenHash);
    } catch (e) {
      console.error('portal: buscarPorEnlace', e);
      return c.json({ error: ERROR_GENERICO }, 500);
    }
    if (!enlace) return c.json({ error: 'Enlace no válido' }, 401);
    if (!enlace.vigente) {
      return c.json({ error: 'Este enlace venció. Solicite uno nuevo a su asesor.', vencido: true }, 410);
    }
    c.set('enlace', enlace);
    c.set('tokenHash', tokenHash);
    await next();
  });

  app.onError((e, c) => {
    console.error('portal:', e);
    return c.json({ error: ERROR_GENERICO }, 500);
  });

  /** Ejecuta un turno del agente y guarda la conversación. */
  const turno = async (enlace: ExpedienteEnlace, mensaje: string) => {
    const puerto = dep.puerto(enlace.expedienteId);
    const historial = await dep.historial(enlace.expedienteId);
    const r = await dep.atender(puerto, { historial, mensaje, canal: 'web' });
    await dep.guardarMensaje(enlace, 'saliente', r.respuesta);
    if (r.respuestaReemplazada) await dep.avisarReemplazo(enlace);
    return r.respuesta;
  };

  app.get('/vista', async (c) => {
    const enlace = c.get('enlace');
    const [vista, historial] = await Promise.all([dep.puerto(enlace.expedienteId).vista(), dep.historial(enlace.expedienteId)]);
    return c.json({
      marca: enlace.marca,
      vista: vistaSegura(vista),
      conversacion: historial.filter((m) => !terminoReservado(m.texto)),
    });
  });

  app.post('/mensaje', async (c) => {
    const cuerpo = z.object({ texto: z.string().trim().min(1).max(2000) }).safeParse(await c.req.json().catch(() => ({})));
    if (!cuerpo.success) return c.json({ error: 'Escriba un mensaje de hasta 2,000 caracteres.' }, 400);
    const enlace = c.get('enlace');
    await dep.guardarMensaje(enlace, 'entrante', cuerpo.data.texto);
    return c.json({ respuesta: await turno(enlace, cuerpo.data.texto) });
  });

  app.post(
    '/documento',
    bodyLimit({ maxSize: MAX_DOCUMENTO_BYTES + 64 * 1024, onError: (c) => c.json({ error: 'El archivo supera 10 MB.' }, 413) }),
    async (c) => {
      const enlace = c.get('enlace');
      if (!documentos.permitir(c.get('tokenHash'))) return c.json({ error: 'Ha enviado muchos archivos. Intente más tarde.' }, 429);
      const formulario = await c.req.parseBody().catch(() => null);
      const archivo = formulario?.archivo;
      if (!archivo || typeof archivo === 'string') return c.json({ error: 'Adjunte un archivo.' }, 400);
      if (archivo.size > MAX_DOCUMENTO_BYTES) return c.json({ error: 'El archivo supera 10 MB.' }, 413);
      if (archivo.size === 0) return c.json({ error: 'El archivo está vacío.' }, 400);
      const bytes = Buffer.from(await archivo.arrayBuffer());
      const mime = tipoReal(bytes);
      if (!mime) return c.json({ error: 'Formato no admitido. Envíe una foto (JPG, PNG o WEBP) o un PDF.' }, 415);
      const pista = typeof formulario?.nota === 'string' ? formulario.nota.slice(0, 200) : undefined;

      await dep.guardarMensaje(enlace, 'entrante', `[Archivo enviado: ${archivo.name.slice(0, 80)}]`, 'document');
      const { nota } = await dep.procesarDocumento(enlace.expedienteId, { bytes, mime, pista });
      const respuesta = await turno(enlace, `[Nota del sistema, no la repitas literalmente] ${nota}${pista ? `\nEl cliente escribió: ${pista}` : ''}`);
      return c.json({ respuesta });
    },
  );

  app.post('/codigo-whatsapp', async (c) => {
    const enlace = c.get('enlace');
    const numero = await dep.numeroWhatsapp(enlace.organizacionId);
    if (!numero) return c.json({ error: 'Por ahora puede continuar solo por este portal.' }, 409);
    const codigo = nuevoCodigoVinculacion();
    await dep.guardarCodigoWhatsapp(enlace.expedienteId, codigo.hash, codigo.expiraEn);
    const digitos = numero.replace(/\D/g, '');
    return c.json({
      codigo: codigo.codigo,
      numero,
      expiraEn: codigo.expiraEn,
      enlaceWhatsapp: `https://wa.me/${digitos}?text=${codigo.codigo}`,
    });
  });

  app.post('/enviar-a-revision', async (c) => {
    const enlace = c.get('enlace');
    const r = await dep.puerto(enlace.expedienteId).enviarARevision();
    return c.json(r);
  });

  return app;
}

// ------------------------------------------------------- implementación real

function marcaDe(marca: unknown, nombreComercial: string): Marca {
  const m = (marca ?? {}) as { nombre_visible?: string; color_primario?: string; logo_url?: string };
  const color = /^#[0-9a-fA-F]{6}$/.test(m.color_primario ?? '') ? m.color_primario! : '#0f5e5a';
  const logo = /^https:\/\//.test(m.logo_url ?? '') ? m.logo_url! : null;
  return { nombreVisible: m.nombre_visible || nombreComercial, colorPrimario: color, logoUrl: logo };
}

export function dependenciasSupabase(): DependenciasPortal {
  return {
    async buscarPorEnlace(tokenHash) {
      const filas = (await sinError(db().rpc('expediente_por_enlace', { p_token_hash: tokenHash }))) as any[];
      const f = filas?.[0];
      if (!f) return null;
      return {
        expedienteId: f.expediente_id,
        organizacionId: f.organizacion_id,
        vigente: !!f.vigente,
        marca: marcaDe(f.marca, f.nombre_comercial),
      };
    },

    puerto(expedienteId) {
      return crearPuerto(expedienteId, {
        alIdentificar: async (i) => { await inngest.send({ name: 'aml/persona.identificada', data: i }); },
        alEnviarARevision: async (organizacionId) => {
          await inngest.send({ name: 'aml/expediente.enviado_a_revision', data: { organizacionId, expedienteId } });
        },
      });
    },

    async historial(expedienteId) {
      const filas = (await sinError(
        db().from('mensajes').select('direccion, texto').eq('expediente_id', expedienteId)
          .not('texto', 'is', null).order('recibido_en', { ascending: false }).limit(20),
      )) as { direccion: string; texto: string }[];
      return filas.reverse().map((m) => ({ rol: m.direccion === 'entrante' ? 'cliente' : 'agente', texto: m.texto }));
    },

    async guardarMensaje(e, direccion, texto, tipo = 'text') {
      await sinError(db().from('mensajes').insert({
        organizacion_id: e.organizacionId,
        expediente_id: e.expedienteId,
        direccion,
        canal: 'web',
        tipo,
        texto,
        procesado_en: direccion === 'saliente' ? new Date().toISOString() : null,
      }));
    },

    atender: (puerto, t) => atenderTurno(clienteClaude(), puerto, t),

    procesarDocumento: (expedienteId, a) =>
      procesarDocumento(clienteClaude(), expedienteId, { bytes: a.bytes, mime: a.mime, canal: 'web', pista: a.pista }),

    async guardarCodigoWhatsapp(expedienteId, hash, expiraEn) {
      await sinError(db().from('expedientes')
        .update({ codigo_vinculacion_hash: hash, codigo_vinculacion_expira: expiraEn })
        .eq('id', expedienteId));
    },

    async numeroWhatsapp(organizacionId) {
      const c = await sinError(db().from('canales_whatsapp').select('numero_visible, estado')
        .eq('organizacion_id', organizacionId).maybeSingle());
      return c && (c as any).estado === 'activo' ? ((c as any).numero_visible as string) : null;
    },

    async avisarReemplazo(e) {
      await sinError(db().from('notificaciones').insert({
        organizacion_id: e.organizacionId, destinatario_rol: 'cumplimiento', expediente_id: e.expedienteId,
        prioridad: 'alta', asunto: 'Respuesta del agente bloqueada',
        cuerpo: 'En el portal web, el agente intentó enviar al cliente un texto con términos reservados y se sustituyó por una respuesta neutra. Revise la conversación.',
      }));
    },
  };
}

let instancia: ReturnType<typeof crearApiPortal> | undefined;
/** API lista para montar: `app.route('/api/portal', apiPortal())`. */
export function apiPortal() {
  instancia ??= crearApiPortal(dependenciasSupabase());
  return instancia;
}
