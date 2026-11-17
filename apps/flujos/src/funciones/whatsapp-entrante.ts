import { atenderTurno, clienteClaude } from '@agente-aml/agente';
import { inngest } from '../cliente-inngest.js';
import { config } from '../config.js';
import { db, sinError } from '../datos.js';
import { procesarDocumento } from '../documentos-entrantes.js';
import { respuestas } from '../plantillas.js';
import { crearPuerto } from '../repositorio.js';
import { descargarMedio, enviarTexto, type Canal } from '../whatsapp.js';

const TIPOS_ARCHIVO = new Set(['image', 'document']);

/**
 * Mensaje entrante de WhatsApp:
 * 1. Identifica la organización por el número que lo recibió.
 * 2. Si el número del cliente no está vinculado, solo acepta el código de 6 dígitos.
 * 3. Si trae un archivo, lo guarda, lo identifica y lo lee.
 * 4. El agente responde con el contexto del expediente del lado del cliente.
 * Los mensajes de un mismo cliente se atienden en orden, uno a la vez.
 */
export const whatsappEntrante = inngest.createFunction(
  {
    id: 'whatsapp-entrante',
    idempotency: 'event.data.mensajeId',
    concurrency: { key: 'event.data.waId', limit: 1 },
  },
  { event: 'aml/whatsapp.mensaje' },
  async ({ event, step }) => {
    const m = event.data;

    const contexto = await step.run('identificar', async () => {
      const canal = await sinError(
        db().from('canales_whatsapp').select('organizacion_id').eq('phone_number_id', m.phoneNumberId).maybeSingle(),
      );
      if (!canal) return null;
      const exp = await sinError(
        db().from('expedientes').select('id').eq('organizacion_id', (canal as any).organizacion_id)
          .eq('whatsapp_wa_id', m.waId).order('creado_en', { ascending: false }).limit(1).maybeSingle(),
      );
      return { organizacionId: (canal as any).organizacion_id as string, expedienteId: ((exp as any)?.id ?? null) as string | null };
    });
    if (!contexto) return { resultado: 'numero_desconocido' };

    await step.run('guardar-entrante', () =>
      sinError(db().from('mensajes').upsert({
        organizacion_id: contexto.organizacionId,
        expediente_id: contexto.expedienteId,
        direccion: 'entrante',
        wa_id: m.waId,
        wa_message_id: m.mensajeId,
        tipo: m.tipo,
        texto: m.texto ?? null,
        media_id: m.mediaId ?? null,
        recibido_en: new Date(Number(m.timestamp) * 1000).toISOString(),
      }, { onConflict: 'wa_message_id', ignoreDuplicates: true })));

    const canal = async (): Promise<Canal | null> => {
      const token = await sinError(db().rpc('token_canal', { p_phone_number_id: m.phoneNumberId }));
      return token ? { phoneNumberId: m.phoneNumberId, token: token as string, graphApiVersion: config.graphApiVersion } : null;
    };
    const responder = (id: string, texto: string) =>
      step.run(id, async () => {
        const c = await canal();
        if (!c) return null;
        const waMessageId = await enviarTexto(c, m.waId, texto);
        await sinError(db().from('mensajes').insert({
          organizacion_id: contexto.organizacionId, expediente_id: contexto.expedienteId, direccion: 'saliente',
          wa_id: m.waId, wa_message_id: waMessageId ?? null, tipo: 'text', texto,
        }));
        return waMessageId;
      });

    // Vinculación del número con el expediente
    if (!contexto.expedienteId) {
      const codigo = m.texto?.trim().match(/^\d{6}$/)?.[0];
      if (!codigo) {
        await responder('responder-no-vinculado', respuestas.noVinculado);
        return { resultado: 'no_vinculado' };
      }
      const exp = await step.run('vincular', () =>
        sinError(db().rpc('vincular_whatsapp', { p_phone_number_id: m.phoneNumberId, p_wa_id: m.waId, p_codigo: codigo })));
      await responder('responder-vinculacion', exp ? respuestas.vinculado : respuestas.codigoInvalido);
      return { resultado: exp ? 'vinculado' : 'codigo_invalido' };
    }
    const expedienteId = contexto.expedienteId;

    // Archivo recibido
    let mensajeParaAgente = m.texto ?? '';
    if (TIPOS_ARCHIVO.has(m.tipo) && m.mediaId) {
      const nota = await step.run('procesar-documento', async () => {
        const c = await canal();
        if (!c) throw new Error('Canal sin token');
        const medio = await descargarMedio(c, m.mediaId!);
        return (await procesarDocumento(clienteClaude(), expedienteId, {
          bytes: medio.bytes, mime: medio.mime, canal: 'whatsapp', pista: m.texto,
        })).nota;
      });
      mensajeParaAgente = `[Nota del sistema, no la repitas literalmente] ${nota}${m.texto ? `\nEl cliente escribió: ${m.texto}` : ''}`;
    } else if (!mensajeParaAgente) {
      mensajeParaAgente = '[Nota del sistema] El cliente envió un mensaje sin texto (audio, ubicación o similar). Pídele que escriba su respuesta.';
    }

    // Turno del agente
    const respuesta = await step.run('agente', async () => {
      const historial = ((await sinError(
        db().from('mensajes').select('direccion, texto, wa_message_id').eq('expediente_id', expedienteId)
          .not('texto', 'is', null).order('recibido_en', { ascending: false }).limit(21),
      )) as { direccion: string; texto: string; wa_message_id: string }[])
        .filter((x) => x.wa_message_id !== m.mensajeId)
        .slice(0, 20)
        .reverse()
        .map((x) => ({ rol: x.direccion === 'entrante' ? ('cliente' as const) : ('agente' as const), texto: x.texto }));

      const puerto = crearPuerto(expedienteId, {
        alIdentificar: async (i) => {
          await inngest.send({ name: 'aml/persona.identificada', data: i });
        },
        alEnviarARevision: async (organizacionId) => {
          await inngest.send({ name: 'aml/expediente.enviado_a_revision', data: { organizacionId, expedienteId } });
        },
      });
      const r = await atenderTurno(clienteClaude(), puerto, { historial, mensaje: mensajeParaAgente, canal: 'whatsapp' });
      await sinError(db().from('mensajes').update({ procesado_en: new Date().toISOString() }).eq('wa_message_id', m.mensajeId));
      return { texto: r.respuesta, reemplazada: r.respuestaReemplazada, acciones: r.acciones.map((a) => a.herramienta) };
    });

    if (respuesta.reemplazada) {
      await step.run('avisar-reemplazo', () =>
        sinError(db().from('notificaciones').insert({
          organizacion_id: contexto.organizacionId, destinatario_rol: 'cumplimiento', expediente_id: expedienteId,
          prioridad: 'alta', asunto: 'Respuesta del agente bloqueada',
          cuerpo: 'El agente intentó enviar al cliente un texto con términos reservados y se sustituyó por una respuesta neutra. Revise la conversación.',
        })));
    }

    await responder('responder', respuesta.texto);
    return { resultado: 'atendido', acciones: respuesta.acciones };
  },
);
