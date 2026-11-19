import { claveNombre, personasIdentificadas, type Dato } from '@agente-aml/agente';
import { cotejar, parsearListaOfac, parsearListaOnu, type Consulta, type ListaCargada, type RegistroLista } from '@agente-aml/listas';
import { inngest } from '../cliente-inngest.js';
import { config } from '../config.js';
import { db, notificar, sinError } from '../datos.js';
import { cargarDesignacionesVigentes } from '../designaciones.js';
import { cargarListaVigente, planificarActualizacion, TABLAS_OFAC, TABLAS_ONU, type TablasLista } from '../lista-onu.js';

type Fuente = 'onu' | 'designacion_1373' | 'ofac';
const NOMBRE_FUENTE: Record<Fuente, string> = {
  onu: 'la lista de la ONU',
  designacion_1373: 'las designaciones de la S/RES/1373',
  ofac: 'la lista SDN de la OFAC',
};


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
  fuente: Fuente = 'onu',
) {
  const detectadaEn = new Date();
  const verificacion = await sinError(db().from('verificaciones').insert({
    organizacion_id: organizacionId,
    expediente_id: expedienteId,
    persona_relacionada_id: personaRelacionadaId,
    nombre_consultado: consulta.nombre,
    fuente,
    version_fuente: version,
    consultado_en: detectadaEn.toISOString(),
    resultado: coincidencias.length ? 'posible_coincidencia' : 'sin_coincidencia',
    coincidencias,
  }).select('id').single());
  if (!coincidencias.length) return;

  // OFAC no es lista del art. 43: la base abre la alerta OFAC_POSIBLE (sin
  // vencimiento) y aquí solo se avisa a cumplimiento. Sin plazo ni escalamiento.
  if (fuente === 'ofac') {
    await notificar(organizacionId, 'cumplimiento', `Posible coincidencia con ${NOMBRE_FUENTE.ofac}`,
      `${consulta.nombre}: ${coincidencias.length} posible(s) coincidencia(s). Dispóngala antes de decidir; si se confirma, `
      + 'aplique debida diligencia intensificada. No hay bloqueo del art. 43 ni comunicación al Ministerio Público.',
      { expedienteId, prioridad: 'alta' });
    return;
  }

  const verificacionId = (verificacion as { id: string }).id;
  // La alerta ONU_POSIBLE la abre la base al registrar la verificación
  // (disparador verificaciones_alerta, vencimiento = detección + 24 h). Si se
  // insertara otra aquí, la base la descarta por duplicada y .single() fallaría,
  // reintentando el paso; solo se recupera la que ya existe.
  const alerta = await sinError(db().from('alertas').select('id')
    .eq('expediente_id', expedienteId).eq('senal', 'ONU_POSIBLE')
    .contains('evidencia', { verificacionId }).limit(1).single());
  // Aviso solo a cumplimiento. El cliente y el área comercial no se enteran (art. 38).
  await notificar(organizacionId, 'cumplimiento', `Posible coincidencia con ${NOMBRE_FUENTE[fuente]}: plazo de 24 horas en curso`,
    `${consulta.nombre}: ${coincidencias.length} posible(s) coincidencia(s). El plazo del art. 43 corre desde la detección.`,
    { expedienteId, prioridad: coincidencias.some((c) => c.prioridad === 'alta') ? 'urgente' : 'alta' });
  await inngest.send({
    name: 'aml/onu.posible_coincidencia',
    data: { organizacionId, expedienteId, verificacionId, alertaId: (alerta as { id: string }).id, detectadaEn: detectadaEn.toISOString() },
  });
}

/**
 * Etapa 5: cotejo al identificar al cliente, la entidad, el representante o un
 * beneficiario final, contra la lista de la ONU y, si la plataforma registró
 * alguna, contra las designaciones de la S/RES/1373 (art. 43 c).
 */
export const cotejoInicial = inngest.createFunction(
  { id: 'cotejo-onu-inicial' },
  { event: 'aml/persona.identificada' },
  async ({ event, step }) => {
    const d = event.data;
    const consulta: Consulta = { nombre: d.nombre, tipo: d.tipo, fechaNacimiento: d.fechaNacimiento };
    /** Sin duplicados: el mismo nombre con la misma versión de la fuente se coteja una sola vez. */
    const yaCotejado = async (fuente: Fuente, version: string) => {
      const previas = (await sinError(
        db().from('verificaciones').select('nombre_consultado').eq('expediente_id', d.expedienteId)
          .eq('fuente', fuente).eq('version_fuente', version),
      )) as { nombre_consultado: string }[];
      return previas.some((p) => claveNombre(p.nombre_consultado) === claveNombre(d.nombre));
    };

    const onu = await step.run('cotejar', async () => {
      const lista = await cargarListaVigente();
      if (!lista.sha256) throw new Error('No hay lista ONU cargada; el cotejo no puede omitirse');
      if (await yaCotejado('onu', lista.sha256)) return { duplicado: true };
      const r = cotejar(consulta, lista.registros);
      await registrarResultado(d.organizacionId, d.expedienteId, d.personaRelacionadaId ?? null, consulta, lista.sha256, r);
      return { coincidencias: r.length };
    });

    const designaciones = await step.run('cotejar-1373', async () => {
      const lista = await cargarDesignacionesVigentes();
      if (!lista.version) return { sinDesignaciones: true };
      if (await yaCotejado('designacion_1373', lista.version)) return { duplicado: true };
      const r = cotejar(consulta, lista.registros);
      await registrarResultado(d.organizacionId, d.expedienteId, d.personaRelacionadaId ?? null, consulta, lista.version, r, 'designacion_1373');
      return { coincidencias: r.length };
    });
    const ofac = await step.run('cotejar-ofac', async () => {
      const lista = await cargarListaVigente(TABLAS_OFAC);
      if (!lista.sha256) return { sinLista: true };
      if (await yaCotejado('ofac', lista.sha256)) return { duplicado: true };
      const r = cotejar(consulta, lista.registros);
      await registrarResultado(d.organizacionId, d.expedienteId, d.personaRelacionadaId ?? null, consulta, lista.sha256, r, 'ofac');
      return { coincidencias: r.length };
    });
    return { onu, designaciones, ofac };
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

interface ListaDescargable {
  fuente: 'onu' | 'ofac';
  nombre: string;
  tablas: TablasLista;
  url: () => string;
  parsear: (xml: string) => ListaCargada;
}

const LISTA_ONU: ListaDescargable = {
  fuente: 'onu', nombre: 'la lista ONU', tablas: TABLAS_ONU, url: () => config.onuListaUrl, parsear: parsearListaOnu,
};
const LISTA_OFAC: ListaDescargable = {
  fuente: 'ofac', nombre: 'la lista SDN de la OFAC', tablas: TABLAS_OFAC, url: () => config.ofacListaUrl, parsear: parsearListaOfac,
};

/**
 * Descarga la lista; si cambió, carga los registros y SOLO AL FINAL registra
 * la versión, para que un fallo a medias se vuelva a intentar completo (A5).
 * Devuelve las referencias contra las que hay que recotejar la cartera.
 */
async function descargarYGuardar(l: ListaDescargable): Promise<{ sha256: string; referencias: string[] } | null> {
  const r = await fetch(l.url());
  if (!r.ok) throw new Error(`No se pudo descargar ${l.nombre}: ${r.status}`);
  const nueva = l.parsear(await r.text());
  const anterior = await cargarListaVigente(l.tablas);
  const parcial = await sinError(
    db().from(l.tablas.registros).select('referencia').eq('version_sha256', nueva.sha256).limit(1),
  );
  const plan = planificarActualizacion(anterior, nueva, anterior.sha256 !== nueva.sha256 && ((parcial as any[]) ?? []).length > 0);
  if (plan.sinCambios) return null;
  // 1. Registros (la versión nueva debe existir antes por la llave foránea; se registra
  //    marcada como pendiente con cargada_en en el pasado y se actualiza al final).
  await sinError(db().from(l.tablas.versiones).upsert({
    sha256: nueva.sha256, generada_el: nueva.generadaEl ?? null, registros: nueva.registros.length,
    cargada_en: new Date(0).toISOString(),
  }, { onConflict: 'sha256' }));
  for (let i = 0; i < nueva.registros.length; i += 500) {
    await sinError(db().from(l.tablas.registros).upsert(
      nueva.registros.slice(i, i + 500).map((reg) => ({
        referencia: reg.referencia, tipo: reg.tipo, datos: reg, version_sha256: nueva.sha256,
        actualizado_en: new Date().toISOString(),
      })),
    ));
  }
  for (let i = 0; i < plan.retirados.length; i += 500) {
    await sinError(db().from(l.tablas.registros).delete().in('referencia', plan.retirados.slice(i, i + 500)));
  }
  // 2. Solo ahora la versión pasa a ser la vigente (la más reciente por cargada_en)
  await sinError(db().from(l.tablas.versiones).update({ cargada_en: new Date().toISOString() }).eq('sha256', nueva.sha256));
  return { sha256: nueva.sha256, referencias: plan.revisar.map((x) => x.referencia) };
}

/** Coteja la cartera activa contra los registros nuevos o modificados de la lista. */
async function recotejarCartera(step: any, l: ListaDescargable, cambios: { sha256: string; referencias: string[] }) {
  const cartera: Persona[] = await step.run('cargar-cartera', cargarCartera);
  let encontradas = 0;
  for (let i = 0; i < cartera.length; i += 200) {
    encontradas += await step.run(`recotejar-${i}`, async () => {
      const revisar: RegistroLista[] = [];
      for (let j = 0; j < cambios.referencias.length; j += 500) {
        const lote = (await sinError(
          db().from(l.tablas.registros).select('datos').in('referencia', cambios.referencias.slice(j, j + 500)),
        )) as { datos: RegistroLista }[];
        revisar.push(...lote.map((x) => x.datos));
      }
      let n = 0;
      for (const c of cartera.slice(i, i + 200)) {
        const consulta: Consulta = { nombre: c.nombre, tipo: c.tipo, fechaNacimiento: c.fechaNacimiento };
        const r = cotejar(consulta, revisar);
        if (r.length) {
          await registrarResultado(c.organizacionId, c.expedienteId, null, consulta, cambios.sha256, r, l.fuente);
          n++;
        }
      }
      return n;
    });
  }
  return { revisados: cambios.referencias.length, cartera: cartera.length, encontradas };
}

/**
 * Control permanente (art. 43): descarga diaria de la lista de la ONU y
 * recotejo de la cartera activa contra los registros nuevos o modificados.
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
    const cambios = await step.run('descargar-y-guardar', () => descargarYGuardar(LISTA_ONU));
    if (!cambios || !cambios.referencias.length) return { cambios: 0 };
    return recotejarCartera(step, LISTA_ONU, cambios);
  },
);

/**
 * Lista SDN de la OFAC (criterio del 19-nov-2026, opción A): descarga diaria y
 * recotejo igual que la ONU, pero una coincidencia solo genera alerta y
 * debida diligencia intensificada (sin bloqueo del art. 43).
 */
export const actualizarOfacYRecotejar = inngest.createFunction(
  {
    id: 'lista-ofac-diaria',
    concurrency: { limit: 1 },
    onFailure: async ({ error }) => {
      await sinError(db().from('avisos_plataforma').insert({
        asunto: 'Falló la actualización diaria de la lista OFAC',
        cuerpo: `La lista SDN de la OFAC no se actualizó: ${error.message}. Revise el flujo lista-ofac-diaria.`,
      }));
    },
  },
  { cron: 'TZ=America/Guatemala 30 5 * * *' },
  async ({ step }) => {
    const cambios = await step.run('descargar-y-guardar', () => descargarYGuardar(LISTA_OFAC));
    if (!cambios || !cambios.referencias.length) return { cambios: 0 };
    return recotejarCartera(step, LISTA_OFAC, cambios);
  },
);

/**
 * Control permanente de las designaciones 1373: al registrarse una nueva, la
 * plataforma emite el evento y aquí se coteja toda la cartera activa contra
 * esa designación. Solo se registran las posibles coincidencias (igual que el
 * recotejo diario de la ONU).
 */
export const recotejarDesignacion = inngest.createFunction(
  {
    id: 'designacion-1373-registrada',
    concurrency: { limit: 1 },
    onFailure: async ({ error }) => {
      await sinError(db().from('avisos_plataforma').insert({
        asunto: 'Falló el recotejo de una designación 1373',
        cuerpo: `La cartera no se cotejó contra la designación registrada: ${error.message}. Revise el flujo designacion-1373-registrada.`,
      }));
    },
  },
  { event: 'aml/designacion_1373.registrada' },
  async ({ event, step }) => {
    const designacion = await step.run('cargar-designacion', async () => {
      const lista = await cargarDesignacionesVigentes();
      const registro = lista.registros.find((r) => r.referencia === `1373:${event.data.designacionId}`);
      return registro && lista.version ? { registro, version: lista.version } : null;
    });
    if (!designacion) return { revocadaOInexistente: true };
    const cartera = await step.run('cargar-cartera', cargarCartera);
    let encontradas = 0;
    for (let i = 0; i < cartera.length; i += 200) {
      encontradas += await step.run(`recotejar-${i}`, async () => {
        let n = 0;
        for (const c of cartera.slice(i, i + 200)) {
          const consulta: Consulta = { nombre: c.nombre, tipo: c.tipo, fechaNacimiento: c.fechaNacimiento };
          const r = cotejar(consulta, [designacion.registro]);
          if (r.length) {
            await registrarResultado(c.organizacionId, c.expedienteId, null, consulta, designacion.version, r, 'designacion_1373');
            n++;
          }
        }
        return n;
      });
    }
    return { cartera: cartera.length, encontradas };
  },
);
