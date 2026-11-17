import { claveNombre, personasIdentificadas, type Dato } from '@agente-aml/agente';
import { cotejar, parsearListaOnu, type Consulta, type RegistroLista } from '@agente-aml/listas';
import { inngest } from '../cliente-inngest.js';
import { config } from '../config.js';
import { db, notificar, sinError } from '../datos.js';
import { cargarListaVigente, planificarActualizacion } from '../lista-onu.js';


/**
 * Registra el resultado de un cotejo. Si hay posibles coincidencias, abre en
 * ese momento la alerta con vencimiento a 24 horas (art. 43: "comunicar por
 * escrito, en un plazo que no exceda de veinticuatro horas al Ministerio
 * Público"), y dispara el escalamiento: el plazo corre desde la detección y no
 * desde que el oficial confirma (A6).
 */
async function registrarResultado(
  organizacionId: string,
  expedienteId: string,
  personaRelacionadaId: string | null,
  consulta: Consulta,
  version: string,
  coincidencias: ReturnType<typeof cotejar>,
) {
  const detectadaEn = new Date();
  const verificacion = await sinError(db().from('verificaciones').insert({
    organizacion_id: organizacionId,
    expediente_id: expedienteId,
    persona_relacionada_id: personaRelacionadaId,
    nombre_consultado: consulta.nombre,
    fuente: 'onu',
    version_fuente: version,
    consultado_en: detectadaEn.toISOString(),
    resultado: coincidencias.length ? 'posible_coincidencia' : 'sin_coincidencia',
    coincidencias,
  }).select('id').single());
  if (!coincidencias.length) return;

  const verificacionId = (verificacion as { id: string }).id;
  // La alerta ONU_POSIBLE la abre la base al registrar la verificación
  // (disparador verificaciones_alerta, vencimiento = detección + 24 h). Si se
  // insertara otra aquí, la base la descarta por duplicada y .single() fallaría,
  // reintentando el paso; solo se recupera la que ya existe.
  const alerta = await sinError(db().from('alertas').select('id')
    .eq('expediente_id', expedienteId).eq('senal', 'ONU_POSIBLE')
    .contains('evidencia', { verificacionId }).limit(1).single());
  // Aviso solo a cumplimiento. El cliente y el área comercial no se enteran (art. 38).
  await notificar(organizacionId, 'cumplimiento', 'Posible coincidencia en lista de la ONU: plazo de 24 horas en curso',
    `${consulta.nombre}: ${coincidencias.length} posible(s) coincidencia(s). El plazo del art. 43 corre desde la detección.`,
    { expedienteId, prioridad: coincidencias.some((c) => c.prioridad === 'alta') ? 'urgente' : 'alta' });
  await inngest.send({
    name: 'aml/onu.posible_coincidencia',
    data: { organizacionId, expedienteId, verificacionId, alertaId: (alerta as { id: string }).id, detectadaEn: detectadaEn.toISOString() },
  });
}

/** Etapa 5: cotejo al identificar al cliente, la entidad, el representante o un beneficiario final. */
export const cotejoInicial = inngest.createFunction(
  { id: 'cotejo-onu-inicial' },
  { event: 'aml/persona.identificada' },
  async ({ event, step }) => {
    const d = event.data;
    return step.run('cotejar', async () => {
      const lista = await cargarListaVigente();
      if (!lista.sha256) throw new Error('No hay lista ONU cargada; el cotejo no puede omitirse');
      // Sin duplicados: el mismo nombre con la misma versión de la lista se coteja una sola vez
      const previas = (await sinError(
        db().from('verificaciones').select('nombre_consultado').eq('expediente_id', d.expedienteId)
          .eq('fuente', 'onu').eq('version_fuente', lista.sha256),
      )) as { nombre_consultado: string }[];
      if (previas.some((p) => claveNombre(p.nombre_consultado) === claveNombre(d.nombre))) return { duplicado: true };
      const consulta: Consulta = { nombre: d.nombre, tipo: d.tipo, fechaNacimiento: d.fechaNacimiento };
      const r = cotejar(consulta, lista.registros);
      await registrarResultado(d.organizacionId, d.expedienteId, d.personaRelacionadaId ?? null, consulta, lista.sha256, r);
      return { coincidencias: r.length };
    });
  },
);

const CAMPOS_CARTERA = [
  'cliente.nombre_completo', 'cliente.fecha_nacimiento', 'cliente.documento_numero',
  'entidad.razon_social', 'entidad.nit', 'representante.nombre_completo', 'representante.documento_numero',
  'beneficiarios_finales',
];

interface Persona { expedienteId: string; organizacionId: string; nombre: string; tipo: 'individual' | 'entidad'; fechaNacimiento?: string }

/**
 * Cartera a recotejar: todas las personas identificadas (cliente o entidad,
 * representante y beneficiarios finales) de expedientes no rechazados ni
 * abstenidos y con relación vigente, tengan o no ficha de cliente (A5).
 */
async function cargarCartera(): Promise<Persona[]> {
  const filas: any[] = [];
  for (let desde = 0; ; desde += 1000) {
    const pagina = ((await sinError(
      db().from('datos_expediente')
        .select('expediente_id, campo, valor, origen, confirmado_en, expedientes!inner(organizacion_id, tipo_persona, parte, estado, fin_relacion)')
        .eq('vigente', true)
        .in('campo', CAMPOS_CARTERA)
        .not('expedientes.estado', 'in', '(rechazado,abstenido)')
        .is('expedientes.fin_relacion', null)
        .order('expediente_id')
        .range(desde, desde + 999),
    )) ?? []) as any[];
    filas.push(...pagina);
    if (pagina.length < 1000) break;
  }
  const porExpediente = new Map<string, { exp: any; datos: Record<string, Dato> }>();
  for (const f of filas) {
    const e = porExpediente.get(f.expediente_id) ?? { exp: f.expedientes, datos: {} };
    e.datos[f.campo] = { valor: f.valor, origen: f.origen, confirmado: !!f.confirmado_en };
    porExpediente.set(f.expediente_id, e);
  }
  const salida: Persona[] = [];
  for (const [expedienteId, { exp, datos }] of porExpediente) {
    for (const p of personasIdentificadas({ parte: exp.parte, tipoPersona: exp.tipo_persona }, datos)) {
      salida.push({ expedienteId, organizacionId: exp.organizacion_id, nombre: p.nombre, tipo: p.tipo, fechaNacimiento: p.fechaNacimiento });
    }
  }
  return salida;
}

/**
 * Control permanente (art. 43): descarga diaria de la lista. Si cambió, carga
 * los registros y SOLO AL FINAL registra la versión, para que un fallo a medias
 * se vuelva a intentar completo (A5); luego coteja la cartera activa contra
 * los registros nuevos o modificados.
 */
export const actualizarListaYRecotejar = inngest.createFunction(
  {
    id: 'lista-onu-diaria',
    concurrency: { limit: 1 },
    onFailure: async ({ error }) => {
      await sinError(db().from('avisos_plataforma').insert({
        asunto: 'Falló la actualización diaria de la lista ONU',
        cuerpo: `El control permanente del art. 43 no se completó: ${error.message}. Revise el flujo lista-onu-diaria.`,
      }));
    },
  },
  { cron: 'TZ=America/Guatemala 0 5 * * *' },
  async ({ step }) => {
    const cambios = await step.run('descargar-y-guardar', async () => {
      const r = await fetch(config.onuListaUrl);
      if (!r.ok) throw new Error(`No se pudo descargar la lista ONU: ${r.status}`);
      const nueva = parsearListaOnu(await r.text());
      const anterior = await cargarListaVigente();
      const parcial = await sinError(
        db().from('lista_onu_registros').select('referencia').eq('version_sha256', nueva.sha256).limit(1),
      );
      const plan = planificarActualizacion(anterior, nueva, anterior.sha256 !== nueva.sha256 && ((parcial as any[]) ?? []).length > 0);
      if (plan.sinCambios) return null;
      // 1. Registros (la versión nueva debe existir antes por la llave foránea; se registra
      //    marcada como pendiente con cargada_en en el pasado y se actualiza al final).
      await sinError(db().from('lista_onu_versiones').upsert({
        sha256: nueva.sha256, generada_el: nueva.generadaEl ?? null, registros: nueva.registros.length,
        cargada_en: new Date(0).toISOString(),
      }, { onConflict: 'sha256' }));
      for (let i = 0; i < nueva.registros.length; i += 500) {
        await sinError(db().from('lista_onu_registros').upsert(
          nueva.registros.slice(i, i + 500).map((reg) => ({
            referencia: reg.referencia, tipo: reg.tipo, datos: reg, version_sha256: nueva.sha256,
            actualizado_en: new Date().toISOString(),
          })),
        ));
      }
      if (plan.retirados.length) {
        await sinError(db().from('lista_onu_registros').delete().in('referencia', plan.retirados));
      }
      // 2. Solo ahora la versión pasa a ser la vigente (la más reciente por cargada_en)
      await sinError(db().from('lista_onu_versiones').update({ cargada_en: new Date().toISOString() }).eq('sha256', nueva.sha256));
      return { sha256: nueva.sha256, referencias: plan.revisar.map((x) => x.referencia) };
    });
    if (!cambios || !cambios.referencias.length) return { cambios: 0 };

    const cartera = await step.run('cargar-cartera', cargarCartera);

    let encontradas = 0;
    for (let i = 0; i < cartera.length; i += 200) {
      encontradas += await step.run(`recotejar-${i}`, async () => {
        const revisar: RegistroLista[] = [];
        for (let j = 0; j < cambios.referencias.length; j += 500) {
          const lote = (await sinError(
            db().from('lista_onu_registros').select('datos').in('referencia', cambios.referencias.slice(j, j + 500)),
          )) as { datos: RegistroLista }[];
          revisar.push(...lote.map((x) => x.datos));
        }
        let n = 0;
        for (const c of cartera.slice(i, i + 200)) {
          const consulta: Consulta = { nombre: c.nombre, tipo: c.tipo, fechaNacimiento: c.fechaNacimiento };
          const r = cotejar(consulta, revisar);
          if (r.length) {
            await registrarResultado(c.organizacionId, c.expedienteId, null, consulta, cambios.sha256, r);
            n++;
          }
        }
        return n;
      });
    }
    return { revisados: cambios.referencias.length, cartera: cartera.length, encontradas };
  },
);
