import { inngest } from '../cliente-inngest.js';
import { config } from '../config.js';
import { db, notificar, sinError } from '../datos.js';

/**
 * Ancla diaria de la bitácora (revisión independiente, hallazgo de TRUNCATE y
 * borrado de las últimas filas). Para cada organización:
 *   1. comprueba que el ancla anterior siga en la cadena y que la cadena esté
 *      íntegra (aml.verificar_ancla_bitacora / aml.verificar_bitacora);
 *   2. guarda el último eslabón en aml.anclas_bitacora, tabla que solo el
 *      servidor lee y escribe y que no admite UPDATE, DELETE ni TRUNCATE;
 *   3. si ANCLA_BITACORA_URL está configurada, envía el ancla fuera de la base
 *      (almacenamiento inmutable o sellado de tiempo), de modo que ni quien
 *      administre la base pueda reescribir la cadena sin que se note;
 *   4. ante cualquier diferencia avisa a cumplimiento y al operador de la plataforma.
 */

export interface Eslabon { secuencia: number; hash: string }
export interface ResultadoAncla {
  /** null cuando no había ancla previa con la cual comparar. */
  anclaPreviaValida: boolean | null;
  problemas: number;
  guardar: Eslabon | null;
  alertar: boolean;
}

/** Decide qué hacer con la verificación del día (función pura, se prueba aparte). */
export function evaluarAncla(previa: Eslabon | null, anclaPreviaValida: boolean | null, problemas: number, actual: Eslabon | null): ResultadoAncla {
  const retrocedio = previa && actual ? actual.secuencia < previa.secuencia : Boolean(previa && !actual);
  const alertar = anclaPreviaValida === false || problemas > 0 || retrocedio;
  const guardar = actual && (!previa || actual.secuencia > previa.secuencia) ? actual : null;
  return { anclaPreviaValida, problemas, guardar, alertar };
}

export const anclaBitacora = inngest.createFunction(
  { id: 'ancla-bitacora' },
  { cron: 'TZ=America/Guatemala 30 23 * * *' },
  async ({ step }) => {
    const organizaciones = await step.run('organizaciones', async () =>
      ((await sinError(db().from('organizaciones').select('id'))) as { id: string }[]).map((o) => o.id));

    const resultados: Array<{ organizacionId: string; alertar: boolean; secuencia: number | null }> = [];
    for (const organizacionId of organizaciones) {
      const r = await step.run(`anclar-${organizacionId}`, async () => {
        const previa = (await sinError(db().from('anclas_bitacora').select('secuencia, hash')
          .eq('organizacion_id', organizacionId).order('secuencia', { ascending: false }).limit(1).maybeSingle())) as Eslabon | null;
        const valida = previa
          ? Boolean(await sinError(db().rpc('verificar_ancla_bitacora', { p_organizacion: organizacionId, p_secuencia: previa.secuencia, p_hash: previa.hash })))
          : null;
        const problemas = ((await sinError(db().rpc('verificar_bitacora', { p_organizacion: organizacionId }))) as unknown[] | null)?.length ?? 0;
        const ultimo = ((await sinError(db().rpc('ultimo_eslabon_bitacora', { p_organizacion: organizacionId }))) as Eslabon[] | null)?.[0] ?? null;
        const decision = evaluarAncla(previa, valida, problemas, ultimo);

        if (decision.guardar) {
          await sinError(db().from('anclas_bitacora').insert({
            organizacion_id: organizacionId, secuencia: decision.guardar.secuencia, hash: decision.guardar.hash,
            verificada_previa: decision.anclaPreviaValida,
          }));
          if (config.anclaBitacoraUrl) {
            const resp = await fetch(config.anclaBitacoraUrl, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ organizacionId, secuencia: decision.guardar.secuencia, hash: decision.guardar.hash, registradaEn: new Date().toISOString() }),
            });
            if (!resp.ok) throw new Error(`No se pudo enviar el ancla externa (${resp.status})`);
          }
        }
        if (decision.alertar) {
          const detalle = [
            decision.anclaPreviaValida === false ? `el ancla del eslabón ${previa?.secuencia} ya no coincide con la cadena` : null,
            decision.problemas ? `${decision.problemas} eslabón(es) con problemas de encadenamiento` : null,
            previa && (!ultimo || ultimo.secuencia < previa.secuencia) ? 'la cadena es más corta que la última ancla (posible borrado de eventos)' : null,
          ].filter(Boolean).join('; ');
          await notificar(organizacionId, 'cumplimiento', 'Bitácora: la verificación diaria encontró diferencias',
            `La verificación de integridad de la bitácora encontró: ${detalle}. Conserve la evidencia y contacte al operador de la plataforma.`,
            { prioridad: 'urgente' });
          await sinError(db().from('avisos_plataforma').insert({
            asunto: 'Bitácora alterada o incompleta',
            cuerpo: `Organización ${organizacionId}: ${detalle}.`,
          }));
        }
        return { organizacionId, alertar: decision.alertar, secuencia: decision.guardar?.secuencia ?? null };
      });
      resultados.push(r);
    }
    return { organizaciones: resultados.length, conDiferencias: resultados.filter((r) => r.alertar).length };
  },
);
