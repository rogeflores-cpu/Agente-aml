import { listaGafiDesactualizada } from '@agente-aml/riesgo';
import { inngest } from '../cliente-inngest.js';
import { db, sinError } from '../datos.js';

/**
 * El GAFI no ofrece descarga automática. Este flujo revisa cada semana si la
 * última versión cargada corresponde a un pleno reciente y, si no, avisa al
 * administrador de la plataforma para cargar la nueva declaración.
 */
export const revisarListaGafi = inngest.createFunction(
  { id: 'revisar-lista-gafi' },
  { cron: 'TZ=America/Guatemala 0 8 * * 1' },
  async ({ step }) =>
    step.run('revisar', async () => {
      const vigente = await sinError(db().from('lista_gafi_vigente').select('plenario').maybeSingle());
      const plenario = (vigente as any)?.plenario as string | undefined;
      if (plenario && !listaGafiDesactualizada(plenario)) return { estado: 'al_dia', plenario };
      await sinError(db().from('avisos_plataforma').insert({
        asunto: 'Cargar listas del GAFI',
        cuerpo: plenario
          ? `La última versión cargada es del pleno del ${plenario}. Verifique en fatf-gafi.org las declaraciones del último pleno y cárguelas.`
          : 'No hay listas del GAFI cargadas. El motor de riesgo no puede aplicar el art. 24 ii hasta cargarlas.',
      }));
      return { estado: 'aviso_enviado', plenario: plenario ?? null };
    }),
);
