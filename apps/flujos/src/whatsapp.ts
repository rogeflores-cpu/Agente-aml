import { createHmac, timingSafeEqual } from 'node:crypto';
import { verificarNeutralidad, plantillasWhatsApp, type ClavePlantilla } from './plantillas.js';

/** Valida la cabecera X-Hub-Signature-256 que Meta envía con cada webhook. */
export function firmaValida(cuerpo: string, cabecera: string | undefined | null, appSecret: string): boolean {
  if (!cabecera?.startsWith('sha256=')) return false;
  const esperado = Buffer.from(createHmac('sha256', appSecret).update(cuerpo, 'utf8').digest('hex'), 'hex');
  const recibido = Buffer.from(cabecera.slice(7), 'hex');
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

export interface MensajeEntrante {
  phoneNumberId: string;
  waId: string;
  mensajeId: string;
  tipo: string;
  texto?: string;
  mediaId?: string;
  timestamp: string;
}

/** Extrae los mensajes del cuerpo del webhook. Ignora estados de entrega. */
export function extraerMensajes(payload: any): MensajeEntrante[] {
  const salida: MensajeEntrante[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value;
      const phoneNumberId = v?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      for (const m of v?.messages ?? []) {
        const media = m[m.type];
        salida.push({
          phoneNumberId,
          waId: String(m.from),
          mensajeId: String(m.id),
          tipo: String(m.type),
          texto: m.type === 'text' ? m.text?.body : media?.caption,
          mediaId: media?.id,
          timestamp: String(m.timestamp),
        });
      }
    }
  }
  return salida;
}

export interface Canal { phoneNumberId: string; token: string; graphApiVersion: string }

async function enviar(canal: Canal, cuerpo: Record<string, unknown>) {
  const r = await fetch(`https://graph.facebook.com/${canal.graphApiVersion}/${canal.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${canal.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...cuerpo }),
  });
  const json = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw new Error(`WhatsApp respondió ${r.status}: ${JSON.stringify(json?.error ?? json)}`);
  return json?.messages?.[0]?.id as string | undefined;
}

/** Envía una plantilla aprobada. Los parámetros se revisan con la regla del art. 38. */
export function enviarPlantilla(canal: Canal, destino: string, clave: ClavePlantilla, parametros: string[]) {
  const p = plantillasWhatsApp[clave];
  parametros.forEach(verificarNeutralidad);
  return enviar(canal, {
    to: destino,
    type: 'template',
    template: {
      name: p.nombre,
      language: { code: p.idioma },
      components: [{ type: 'body', parameters: parametros.map((text) => ({ type: 'text', text })) }],
    },
  });
}

/** Texto libre: solo dentro de las 24 horas desde el último mensaje del cliente. */
export function enviarTexto(canal: Canal, destino: string, texto: string) {
  return enviar(canal, { to: destino, type: 'text', text: { body: verificarNeutralidad(texto) } });
}

/** Descarga un archivo recibido por WhatsApp (foto o documento). */
export async function descargarMedio(canal: Canal, mediaId: string): Promise<{ bytes: Buffer; mime: string }> {
  const info = await fetch(`https://graph.facebook.com/${canal.graphApiVersion}/${mediaId}`, {
    headers: { Authorization: `Bearer ${canal.token}` },
  });
  const meta = (await info.json().catch(() => ({}))) as { url?: string; mime_type?: string; error?: unknown };
  if (!info.ok || !meta.url) throw new Error(`No se obtuvo el archivo ${mediaId}: ${JSON.stringify(meta.error ?? info.status)}`);
  const archivo = await fetch(meta.url, { headers: { Authorization: `Bearer ${canal.token}` } });
  if (!archivo.ok) throw new Error(`No se descargó el archivo ${mediaId}: ${archivo.status}`);
  return { bytes: Buffer.from(await archivo.arrayBuffer()), mime: meta.mime_type ?? 'application/octet-stream' };
}
