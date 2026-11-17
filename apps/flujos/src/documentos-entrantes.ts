import { createHash } from 'node:crypto';
import {
  clasificarDocumento,
  documentosPara,
  extraerDocumento,
  prellenar,
  type ArchivoDocumento,
  type ClienteClaude,
} from '@agente-aml/agente';
import { db, sinError } from './datos.js';
import { cargarEntradaRevision, sincronizarPendientes } from './repositorio.js';

const MIME_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

export interface DocumentoProcesado {
  /** Nota para el agente, que la usará para responder al cliente. */
  nota: string;
}

/**
 * Guarda el archivo con su sello SHA-256, identifica qué documento es, lee sus
 * datos, prellena el expediente y recalcula los pendientes.
 */
export async function procesarDocumento(
  claude: ClienteClaude,
  expedienteId: string,
  archivo: { bytes: Buffer; mime: string; canal: 'whatsapp' | 'web'; pista?: string },
): Promise<DocumentoProcesado> {
  const mime = archivo.mime.split(';')[0].trim();
  if (!MIME_PERMITIDOS.has(mime)) {
    return { nota: 'El cliente envió un archivo en un formato que no se puede leer. Pídele una foto (JPG o PNG) o un PDF.' };
  }
  const entrada = await cargarEntradaRevision(expedienteId);
  const org = entrada.base.organizacion_id;
  const sha256 = createHash('sha256').update(archivo.bytes).digest('hex');
  const doc: ArchivoDocumento = { base64: archivo.bytes.toString('base64'), mime: mime as ArchivoDocumento['mime'] };

  const clase = await clasificarDocumento(claude, doc, archivo.pista);
  const esperados = documentosPara(entrada.contexto).flatMap((d) => [d.clave, ...(d.alternativas ?? [])]);
  if (clase.tipo === 'otro' || !esperados.includes(clase.tipo)) {
    return { nota: 'El cliente envió un archivo que no corresponde a ninguno de los documentos que se le piden. Indícale con amabilidad cuáles faltan.' };
  }

  const ruta = `${org}/${expedienteId}/${sha256}.${EXTENSION[mime]}`;
  const subida = await db().storage.from('expedientes').upload(ruta, archivo.bytes, { contentType: mime, upsert: false });
  if (subida.error && !/exists|duplicate/i.test(subida.error.message)) throw new Error(subida.error.message);

  const registrado = await db().from('documentos').insert({
    organizacion_id: org, expediente_id: expedienteId, tipo: clase.tipo, ruta_storage: ruta, sha256,
    mime, tamano_bytes: archivo.bytes.length, canal: archivo.canal,
  }).select('id').single();
  if (registrado.error) {
    if (/duplicate|unique/i.test(registrado.error.message)) {
      return { nota: 'El cliente envió de nuevo un archivo que ya estaba en su expediente. Agradécele e indícale lo que falta.' };
    }
    throw new Error(registrado.error.message);
  }
  const documentoId = (registrado.data as { id: string }).id;

  const r = await extraerDocumento(claude, clase.tipo, doc);
  if (!r.legible || r.tipoDistinto) {
    const motivo = r.motivo_no_legible ?? 'No se pudo leer con claridad. ¿Puede enviarlo de nuevo con buena luz, completo y sin reflejos?';
    await sinError(db().from('documentos').update({ estado: 'observado' }).eq('id', documentoId));
    await sincronizarPendientes(expedienteId);
    return { nota: `El cliente envió su ${clase.tipo.replace(/_/g, ' ')}, pero no se pudo leer bien: ${motivo} Pídele que lo envíe de nuevo.` };
  }

  for (const [campo, v] of Object.entries(r.campos)) {
    if (v.valor === null) continue;
    await sinError(db().rpc('guardar_dato', {
      p_expediente: expedienteId, p_campo: `doc.${clase.tipo}.${campo}`, p_valor: v.valor, p_origen: 'documento',
      p_documento: documentoId, p_pagina: v.pagina ?? null, p_confianza: v.confianza,
    }));
  }
  const propuestas = prellenar(clase.tipo, r.campos, new Set(Object.keys(entrada.datos)));
  for (const p of propuestas) {
    const fuente = r.campos[p.campoDocumento];
    await sinError(db().rpc('guardar_dato', {
      p_expediente: expedienteId, p_campo: p.campo, p_valor: p.valor, p_origen: 'documento',
      p_documento: documentoId, p_pagina: fuente?.pagina ?? null, p_confianza: fuente?.confianza ?? null,
    }));
  }
  await sinError(db().from('documentos').update({ estado: 'extraido' }).eq('id', documentoId));
  await sincronizarPendientes(expedienteId);

  const porConfirmar = propuestas.map((p) => `${p.campo} = ${JSON.stringify(p.valor)}`).join('; ');
  return {
    nota: `El cliente envió su ${clase.tipo.replace(/_/g, ' ')} y se leyó correctamente.` +
      (porConfirmar ? ` Datos leídos que debe confirmar: ${porConfirmar}. Pídele que los confirme y usa confirmar_dato.` : '') +
      (r.dudosos.length ? ` Datos con lectura dudosa, pregúntalos: ${r.dudosos.join(', ')}.` : ''),
  };
}
