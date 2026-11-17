import { createHash } from 'node:crypto';
import {
  clasificarDocumento,
  documentosPara,
  extraerDocumento,
  prellenar,
  type ArchivoDocumento,
  type ClienteClaude,
} from '@agente-aml/agente';
import { MENSAJE_NO_EDITABLE, politicaEdicion } from './cotejos.js';
import { db, notificar, sinError } from './datos.js';
import { cargarEntradaRevision, emitirCotejosPendientes, sincronizarPendientes } from './repositorio.js';

/** Límite por archivo: la lectura con Claude no admite imágenes grandes (B3). */
export const MAX_DOCUMENTO_BYTES = 10 * 1024 * 1024;

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
  if (archivo.bytes.length > MAX_DOCUMENTO_BYTES) {
    return { nota: 'El cliente envió un archivo de más de 10 MB. Pídele una foto o un PDF más liviano.' };
  }
  const entrada = await cargarEntradaRevision(expedienteId);
  const org = entrada.base.organizacion_id;
  const politica = politicaEdicion(entrada.base.estado);
  if (politica === 'rechazar') return { nota: `El expediente ya no admite documentos. Responde al cliente exactamente: "${MENSAJE_NO_EDITABLE}"` };
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
    // Mensajes fijos: el texto libre del modelo lector (que se basa en el documento) no llega al agente (M5)
    const motivo = r.tipoDistinto
      ? 'El archivo no parece ser el documento esperado.'
      : 'No se pudo leer con claridad. ¿Puede enviarlo de nuevo con buena luz, completo y sin reflejos?';
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
  // Un nombre leído del documento se coteja de inmediato, aunque el cliente aún no lo confirme (A1)
  await emitirCotejosPendientes(expedienteId);
  if (politica === 'permitir_y_avisar') {
    await notificar(org, 'cumplimiento', 'El cliente envió un documento después de enviar su expediente',
      `Documento: ${clase.tipo.replace(/_/g, ' ')}. Revise los datos y vuelva a calcular la evaluación antes de decidir.`,
      { expedienteId, prioridad: 'alta' });
  }

  // La nota no lleva valores leídos del documento: el agente los consulta con ver_expediente (M5)
  const porConfirmar = propuestas.map((p) => p.campo).join(', ');
  return {
    nota: `El cliente envió su ${clase.tipo.replace(/_/g, ' ')} y se leyó correctamente.` +
      (porConfirmar ? ` Campos prellenados que el cliente debe confirmar: ${porConfirmar}. Consulta sus valores con ver_expediente, muéstralos al cliente y usa confirmar_dato solo si él lo confirma.` : '') +
      (r.dudosos.length ? ` Campos con lectura dudosa, pregúntalos: ${r.dudosos.join(', ')}.` : ''),
  };
}
