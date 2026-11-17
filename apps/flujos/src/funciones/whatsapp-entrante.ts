import { atenderTurno, clienteClaude } from '@agente-aml/agente';
import { inngest } from '../cliente-inngest.js';
import { config } from '../config.js';
import { LIMITE_CODIGOS, codigoPermitido } from '../cotejos.js';
import { conActor, db, notificar, sinError } from '../datos.js';
import { MAX_DOCUMENTO_BYTES, procesarDocumento } from '../documentos-entrantes.js';
import { respuestas } from '../plantillas.js';
import { crearPuertoConEventos } from '../repositorio.js';
import { ArchivoDemasiadoGrande, descargarMedio, enviarTexto, type Canal } from '../whatsapp.js';

const TIPOS_ARCHIVO = new Set(['image', 'document']);
const PARECE_CODIGO = /^\s*\d{6}\s*$/;

/**
 * Mensaje entrante de WhatsApp:
 * 1. Identifica la organización por el número que lo recibió.
 * 2. Si el número del cliente no está vinculado, solo acepta el código de 6
 *    dígitos, con límite de intentos por número y por organización (A3).
 * 3. Si trae un archivo, lo guarda, lo identifica y lo lee.
 * 4. El agente responde con el contexto del expediente del lado del cliente.
 * Los mensajes de un mismo cliente se atienden en orden, uno a la vez, y un
 * mensaje ya procesado no se procesa de nuevo aunque Meta lo reenvíe (B9).
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

    const yaProcesado = await step.run('guardar-entrante', async () => {
      const previo = await sinError(
        db().from('mensajes').select('procesado_en').eq('wa_message_id', m.mensajeId).maybeSingle(),
      );
      if ((previo as { procesado_en: string | null } | null)?.procesado_en) return true;
      await sinError(db().from('mensajes').upsert({
        organizacion_id: contexto.organizacionId,
        expediente_id: contexto.expedienteId,
        direccion: 'entrante',
        wa_id: m.waId,
        wa_message_id: m.mensajeId,
        tipo: m.tipo,
        texto: m.texto ?? null,
        media_id: m.mediaId ?? null,
        recibido_en: new Date(Number(m.timestamp) * 1000).toISOString(),
      }, { onConflict: 'wa_message_id', ignoreDuplicates: true }));
      return false;
    });
    if (yaProcesado) return { resultado: 'duplicado' };

    const canal = async (): Promise<Canal | null> => {
      const token = await sinError(db().rpc('token_canal', { p_phone_number_id: m.phoneNumberId }));
      return token ? { phoneNumberId: m.phoneNumberId, token: token as string, graphApiVersion: config.graphApiVersion } : null;
    };
    const marcarProcesado = () =>
      sinError(db().from('mensajes').update({ procesado_en: new Date().toISOString() }).eq('wa_message_id', m.mensajeId));
    const responder = (id: string, texto: string, nombresPropios: string[] = []) =>
      step.run(id, async () => {
        const c = await canal();
        if (!c) return null;
        const waMessageId = await enviarTexto(c, m.waId, texto, nombresPropios);
        await sinError(db().from('mensajes').insert({
          organizacion_id: contexto.organizacionId, expediente_id: contexto.expedienteId, direccion: 'saliente',
          wa_id: m.waId, wa_message_id: waMessageId ?? null, tipo: 'text', texto,
        }));
        await marcarProcesado();
        return waMessageId;
      });

    // Vinculación del número con el expediente
    if (!contexto.expedienteId) {
      const codigo = m.texto?.match(PARECE_CODIGO)?.[0].trim();
      if (!codigo) {
        await responder('responder-no-vinculado', respuestas.noVinculado);
        return { resultado: 'no_vinculado' };
      }
      // A3: límite de intentos. Se cuentan los mensajes con forma de código de números no vinculados.
      const permitido = await step.run('limite-intentos', async () => {
        const desde = new Date(Date.now() - LIMITE_CODIGOS.ventanaMinutos * 60_000).toISOString();
        const recientes = (await sinError(
          db().from('mensajes').select('wa_id, texto').eq('organizacion_id', contexto.organizacionId)
            .eq('direccion', 'entrante').is('expediente_id', null).gte('recibido_en', desde).limit(1000),
        )) as { wa_id: string; texto: string | null }[];
        const codigos = recientes.filter((r) => PARECE_CODIGO.test(r.texto ?? ''));
        // El mensaje actual ya está guardado: se descuenta para comparar con el límite
        const delNumero = codigos.filter((r) => r.wa_id === m.waId).length - 1;
        const ok = codigoPermitido(delNumero, codigos.length - 1);
        if (!ok && delNumero === LIMITE_CODIGOS.porNumero) {
          await notificar(contexto.organizacionId, 'cumplimiento', 'Intentos repetidos de vinculación por WhatsApp',
            `El número terminado en ${m.waId.slice(-4)} envió ${delNumero + 1} códigos en menos de ${LIMITE_CODIGOS.ventanaMinutos} minutos. Se dejaron de comprobar.`,
            { prioridad: 'alta' });
        }
        return ok;
      });
      if (!permitido) {
        await responder('responder-limite', respuestas.codigoInvalido);
        return { resultado: 'limite_intentos' };
      }
      const exp = await step.run('vincular', () =>
        sinError(db().rpc('vincular_whatsapp', { p_phone_number_id: m.phoneNumberId, p_wa_id: m.waId, p_codigo: codigo })));
      // La respuesta de error es la misma exista o no el código, haya vencido o no
      await responder('responder-vinculacion', exp ? respuestas.vinculado : respuestas.codigoInvalido);
      return { resultado: exp ? 'vinculado' : 'codigo_invalido' };
    }
    const expedienteId = contexto.expedienteId;

    // Archivo recibido
    let nota: string | undefined;
    if (TIPOS_ARCHIVO.has(m.tipo) && m.mediaId) {
      nota = await step.run('procesar-documento', async () => {
        const c = await canal();
        if (!c) throw new Error('Canal sin token');
        try {
          const medio = await descargarMedio(c, m.mediaId!, MAX_DOCUMENTO_BYTES);
          return (await procesarDocumento(clienteClaude(), expedienteId, {
            bytes: medio.bytes, mime: medio.mime, canal: 'whatsapp', pista: m.texto,
          })).nota;
        } catch (e) {
          if (e instanceof ArchivoDemasiadoGrande) {
            return 'El cliente envió un archivo de más de 10 MB. Pídele una foto o un PDF más liviano.';
          }
          throw e;
        }
      });
    } else if (!m.texto) {
      nota = 'El cliente envió un mensaje sin texto (audio, ubicación o similar). Pídele que escriba su respuesta.';
    }

    // Turno del agente: la nota de la plataforma viaja separada del texto del cliente (M5)
    const respuesta = await step.run('agente', async () => {
      const historial = ((await sinError(
        db().from('mensajes').select('direccion, texto, wa_message_id').eq('expediente_id', expedienteId)
          .not('texto', 'is', null).order('recibido_en', { ascending: false }).limit(21),
      )) as { direccion: string; texto: string; wa_message_id: string }[])
        .filter((x) => x.wa_message_id !== m.mensajeId)
        .slice(0, 20)
        .reverse()
        .map((x) => ({ rol: x.direccion === 'entrante' ? ('cliente' as const) : ('agente' as const), texto: x.texto }));

      // Lo que el agente registra a partir de las respuestas del cliente queda a nombre del cliente
      const r = await conActor({ tipo: 'cliente', id: `whatsapp:${expedienteId}` }, () =>
        atenderTurno(clienteClaude(), crearPuertoConEventos(expedienteId), {
          historial,
          mensaje: m.texto ?? '',
          nota,
          canal: 'whatsapp',
        }));
      return {
        texto: r.respuesta,
        reemplazada: r.respuestaReemplazada,
        nombresPropios: r.nombresPropios ?? [],
        acciones: r.acciones.map((a) => a.herramienta),
      };
    });

    if (respuesta.reemplazada) {
      await step.run('avisar-reemplazo', () =>
        sinError(db().from('notificaciones').insert({
          organizacion_id: contexto.organizacionId, destinatario_rol: 'cumplimiento', expediente_id: expedienteId,
          prioridad: 'alta', asunto: 'Respuesta del agente bloqueada',
          cuerpo: 'El agente intentó enviar al cliente un texto con términos reservados y se sustituyó por una respuesta neutra. Revise la conversación.',
        })));
    }

    await responder('responder', respuesta.texto, respuesta.nombresPropios);
    return { resultado: 'atendido', acciones: respuesta.acciones };
  },
);
