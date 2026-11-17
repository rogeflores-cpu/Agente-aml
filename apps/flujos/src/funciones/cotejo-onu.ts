import { cambiosEntreVersiones, cotejar, parsearListaOnu, type Consulta } from '@agente-aml/listas';
import { inngest } from '../cliente-inngest.js';
import { config } from '../config.js';
import { db, notificar, sinError } from '../datos.js';
import { cargarListaVigente } from '../lista-onu.js';

async function registrarResultado(
  organizacionId: string,
  expedienteId: string,
  personaRelacionadaId: string | null,
  consulta: Consulta,
  version: string,
  coincidencias: ReturnType<typeof cotejar>,
) {
  await sinError(db().from('verificaciones').insert({
    organizacion_id: organizacionId,
    expediente_id: expedienteId,
    persona_relacionada_id: personaRelacionadaId,
    nombre_consultado: consulta.nombre,
    fuente: 'onu',
    version_fuente: version,
    resultado: coincidencias.length ? 'posible_coincidencia' : 'sin_coincidencia',
    coincidencias,
  }));
  if (coincidencias.length) {
    // Aviso solo a cumplimiento. El cliente y el área comercial no se enteran (art. 38).
    await notificar(organizacionId, 'cumplimiento', 'Posible coincidencia en lista de la ONU',
      `${consulta.nombre}: ${coincidencias.length} posible(s) coincidencia(s). Disponer antes de continuar.`,
      { expedienteId, prioridad: coincidencias.some((c) => c.prioridad === 'alta') ? 'urgente' : 'alta' });
  }
}

/** Etapa 5: cotejo al identificar al cliente o a una persona relacionada. */
export const cotejoInicial = inngest.createFunction(
  { id: 'cotejo-onu-inicial' },
  { event: 'aml/persona.identificada' },
  async ({ event, step }) => {
    const d = event.data;
    return step.run('cotejar', async () => {
      const lista = await cargarListaVigente();
      if (!lista.sha256) throw new Error('No hay lista ONU cargada; el cotejo no puede omitirse');
      const consulta: Consulta = { nombre: d.nombre, tipo: d.tipo, fechaNacimiento: d.fechaNacimiento };
      const r = cotejar(consulta, lista.registros);
      await registrarResultado(d.organizacionId, d.expedienteId, d.personaRelacionadaId ?? null, consulta, lista.sha256, r);
      return { coincidencias: r.length };
    });
  },
);

/**
 * Control permanente (art. 43): descarga diaria de la lista. Si cambió, guarda
 * la nueva versión y coteja solo los registros nuevos o modificados contra toda
 * la cartera activa de todas las organizaciones.
 */
export const actualizarListaYRecotejar = inngest.createFunction(
  { id: 'lista-onu-diaria', concurrency: { limit: 1 } },
  { cron: 'TZ=America/Guatemala 0 5 * * *' },
  async ({ step }) => {
    const cambios = await step.run('descargar-y-guardar', async () => {
      const r = await fetch(config.onuListaUrl);
      if (!r.ok) throw new Error(`No se pudo descargar la lista ONU: ${r.status}`);
      const nueva = parsearListaOnu(await r.text());
      const anterior = await cargarListaVigente();
      if (anterior.sha256 === nueva.sha256) return null;
      const c = cambiosEntreVersiones(anterior.registros, nueva.registros);
      await sinError(db().from('lista_onu_versiones').insert({
        sha256: nueva.sha256, generada_el: nueva.generadaEl ?? null, registros: nueva.registros.length,
      }));
      for (let i = 0; i < nueva.registros.length; i += 500) {
        await sinError(db().from('lista_onu_registros').upsert(
          nueva.registros.slice(i, i + 500).map((reg) => ({
            referencia: reg.referencia, tipo: reg.tipo, datos: reg, version_sha256: nueva.sha256,
            actualizado_en: new Date().toISOString(),
          })),
        ));
      }
      if (c.retirados.length) {
        await sinError(db().from('lista_onu_registros').delete().in('referencia', c.retirados));
      }
      return { sha256: nueva.sha256, revisar: [...c.agregados, ...c.modificados] };
    });
    if (!cambios || !cambios.revisar.length) return { cambios: 0 };

    // Cartera activa: clientes con expediente no finalizado o relación vigente.
    const cartera = await step.run('cargar-cartera', async () => {
      const filas = await sinError(
        db().from('expedientes')
          .select('id, organizacion_id, clientes(nombre, tipo_persona, datos)')
          .not('cliente_id', 'is', null)
          .not('estado', 'in', '(rechazado,abstenido)')
          .is('fin_relacion', null),
      );
      return (filas as any[]).map((f) => ({
        expedienteId: f.id as string,
        organizacionId: f.organizacion_id as string,
        nombre: f.clientes.nombre as string,
        tipo: (f.clientes.tipo_persona === 'individual' ? 'individual' : 'entidad') as 'individual' | 'entidad',
        fechaNacimiento: f.clientes.datos?.fecha_nacimiento as string | undefined,
      }));
    });

    let encontradas = 0;
    for (let i = 0; i < cartera.length; i += 200) {
      encontradas += await step.run(`recotejar-${i}`, async () => {
        let n = 0;
        for (const c of cartera.slice(i, i + 200)) {
          const consulta: Consulta = { nombre: c.nombre, tipo: c.tipo, fechaNacimiento: c.fechaNacimiento };
          const r = cotejar(consulta, cambios.revisar);
          if (r.length) {
            await registrarResultado(c.organizacionId, c.expedienteId, null, consulta, cambios.sha256, r);
            n++;
          }
        }
        return n;
      });
    }
    return { revisados: cambios.revisar.length, cartera: cartera.length, encontradas };
  },
);
