import {
  ExpedienteNoEditable,
  claveNombre,
  personasIdentificadas,
  revisar,
  terminoReservado,
  type Contexto,
  type Dato,
  type EntradaRevision,
  type PersonaIdentificada,
  type PuertoExpediente,
  type VistaCliente,
} from '@agente-aml/agente';
import { inngest } from './cliente-inngest.js';
import { MENSAJE_NO_EDITABLE, cotejosPendientes, estadoAparente, idEventoCotejo, politicaEdicion } from './cotejos.js';
import { db, sinError } from './datos.js';
import { estadoParaCliente } from './plantillas.js';

interface ExpedienteBase {
  id: string;
  organizacion_id: string;
  parte: 'comprador' | 'vendedor';
  tipo_persona: 'individual' | 'juridica' | 'estructura';
  estado: string;
  estado_comercial: string;
  /** Estado que se usa hacia el cliente: no delata un examen posterior (art. 38). */
  estado_aparente: string;
  contacto_nombre: string;
  organizaciones: { nombre_comercial: string; marca: { nombre_visible?: string } | null };
}

async function cargarBase(expedienteId: string): Promise<ExpedienteBase> {
  const base = (await sinError(
    db().from('expedientes')
      .select('id, organizacion_id, parte, tipo_persona, estado, estado_comercial, contacto_nombre, organizaciones(nombre_comercial, marca)')
      .eq('id', expedienteId).single(),
  )) as unknown as ExpedienteBase;
  let ultimaAprobacion: 'aprobar' | 'aprobar_diferida' | null = null;
  if (base.estado === 'en_examen' && base.estado_comercial === 'aprobado') {
    const d = (await sinError(db().from('decisiones').select('tipo').eq('expediente_id', expedienteId)
      .in('tipo', ['aprobar', 'aprobar_diferida']).order('decidido_en', { ascending: false }).limit(1).maybeSingle())) as { tipo: 'aprobar' | 'aprobar_diferida' } | null;
    ultimaAprobacion = d?.tipo ?? null;
  }
  return { ...base, estado_aparente: estadoAparente(base.estado, base.estado_comercial, ultimaAprobacion) };
}

/** Solo lee tablas del lado del cliente: datos, documentos y pendientes. */
export async function cargarEntradaRevision(expedienteId: string): Promise<EntradaRevision & { base: ExpedienteBase }> {
  const base = await cargarBase(expedienteId);
  const [datos, documentos] = await Promise.all([
    sinError(db().from('datos_expediente').select('campo, valor, origen, confirmado_en').eq('expediente_id', expedienteId).eq('vigente', true)),
    sinError(db().from('documentos').select('tipo, estado, creado_en').eq('expediente_id', expedienteId).order('creado_en')),
  ]);
  const mapa: Record<string, Dato> = {};
  for (const d of datos as any[]) mapa[d.campo] = { valor: d.valor, origen: d.origen, confirmado: !!d.confirmado_en };
  const nacionalidad = String(mapa['cliente.nacionalidad']?.valor ?? '').toLowerCase();
  const contexto: Contexto = {
    parte: base.parte,
    tipoPersona: base.tipo_persona,
    extranjero: !!nacionalidad && !/guatemal|^gt$/.test(nacionalidad),
  };
  return {
    base,
    contexto,
    datos: mapa,
    documentos: (documentos as any[]).map((d) => ({ clave: d.tipo, estado: d.estado })),
  };
}

/**
 * Recalcula los pendientes con el revisor y los sincroniza con la tabla:
 * cierra los que ya no aplican y agrega los nuevos. Si el expediente está
 * aprobado con verificación diferida y ya no tiene pendientes, avisa al flujo
 * del art. 22 que la verificación se completó.
 */
export async function sincronizarPendientes(expedienteId: string) {
  const entrada = await cargarEntradaRevision(expedienteId);
  const resultado = revisar(entrada);
  const abiertos = (await sinError(
    db().from('pendientes').select('id, tipo, descripcion').eq('expediente_id', expedienteId).eq('estado', 'abierto'),
  )) as { id: string; tipo: string; descripcion: string }[];
  const clave = (p: { tipo: string; descripcion: string }) => `${p.tipo}|${p.descripcion}`;
  const nuevos = new Set(resultado.pendientes.map(clave));
  const existentes = new Set(abiertos.map(clave));
  const resueltos = abiertos.filter((p) => !nuevos.has(clave(p))).map((p) => p.id);
  if (resueltos.length) {
    await sinError(db().from('pendientes').update({ estado: 'resuelto', resuelto_en: new Date().toISOString() }).in('id', resueltos));
  }
  const agregar = resultado.pendientes.filter((p) => !existentes.has(clave(p)));
  if (agregar.length) {
    await sinError(db().from('pendientes').insert(agregar.map((p) => ({
      organizacion_id: entrada.base.organizacion_id,
      expediente_id: expedienteId,
      tipo: p.tipo,
      descripcion: p.descripcion,
    }))));
  }
  if (resultado.completo && entrada.base.estado_aparente === 'aprobado_condicionado') {
    await inngest.send({
      name: 'aml/expediente.diferido_completado',
      data: { organizacionId: entrada.base.organizacion_id, expedienteId },
      id: `diferido-completado-${expedienteId}`,
    });
  }
  return resultado;
}

const ROL_RELACIONADO: Partial<Record<PersonaIdentificada['rol'], string>> = {
  representante: 'representante',
  beneficiario_final: 'beneficiario_final',
};

/**
 * Registra en aml.personas_relacionadas al representante y a los
 * beneficiarios finales declarados, para que apliquen las restricciones de la
 * base (beneficiario final: 15 % o más, o control por otro medio) y para que
 * cada cotejo quede ligado a la persona. No borra filas anteriores (pueden
 * tener documentos o verificaciones asociados). Devuelve el id por nombre.
 */
export async function sincronizarPersonasRelacionadas(
  expedienteId: string,
  organizacionId: string,
  personas: PersonaIdentificada[],
): Promise<Map<string, string>> {
  const existentes = (await sinError(
    db().from('personas_relacionadas').select('id, rol, nombre').eq('expediente_id', expedienteId),
  )) as { id: string; rol: string; nombre: string }[];
  const ids = new Map<string, string>();
  for (const e of existentes) ids.set(`${e.rol}|${claveNombre(e.nombre)}`, e.id);
  for (const p of personas) {
    const rol = ROL_RELACIONADO[p.rol];
    if (!rol) continue;
    const clave = `${rol}|${claveNombre(p.nombre)}`;
    if (ids.has(clave)) continue;
    const { data, error } = await db().from('personas_relacionadas').insert({
      organizacion_id: organizacionId,
      expediente_id: expedienteId,
      rol,
      tipo_persona: p.tipo === 'entidad' ? 'juridica' : 'individual',
      nombre: p.nombre,
      identificacion_num: p.documento ?? null,
      porcentaje: p.porcentaje ?? null,
      controla_por_otro_medio: !!p.controlPorOtroMedio,
    }).select('id').single();
    // Un beneficiario final bajo el 15 % sin control por otro medio lo rechaza la base:
    // el revisor ya lo dejó como pendiente para el cliente.
    if (!error && data) ids.set(clave, (data as { id: string }).id);
  }
  const porNombre = new Map<string, string>();
  for (const p of personas) {
    const rol = ROL_RELACIONADO[p.rol];
    const id = rol ? ids.get(`${rol}|${claveNombre(p.nombre)}`) : undefined;
    if (id) porNombre.set(claveNombre(p.nombre), id);
  }
  return porNombre;
}

export interface Identificacion {
  organizacionId: string;
  expedienteId: string;
  personaRelacionadaId?: string;
  nombre: string;
  tipo: 'individual' | 'entidad';
  fechaNacimiento?: string;
}

/** Emisor por defecto: un evento por persona, con id estable para evitar duplicados. */
export async function emitirIdentificacion(i: Identificacion, version: string | null) {
  await inngest.send({ name: 'aml/persona.identificada', data: i, id: idEventoCotejo(i.expedienteId, i.nombre, version) });
}

/**
 * Dispara el cotejo ONU de toda persona identificada en el expediente (cliente
 * o entidad, representante y beneficiarios finales) que todavía no tenga un
 * cotejo con la versión vigente de la lista. Se llama después de cada cambio
 * de datos, de cada documento leído y al enviar a revisión (A1).
 */
export async function emitirCotejosPendientes(
  expedienteId: string,
  emitir: (i: Identificacion, version: string | null) => Promise<void> = emitirIdentificacion,
): Promise<number> {
  const e = await cargarEntradaRevision(expedienteId);
  const personas = personasIdentificadas(e.contexto, e.datos);
  if (!personas.length) return 0;
  const [version, verificaciones] = await Promise.all([
    sinError(db().from('lista_onu_versiones').select('sha256').order('cargada_en', { ascending: false }).limit(1).maybeSingle()),
    sinError(db().from('verificaciones').select('nombre_consultado, version_fuente').eq('expediente_id', expedienteId).eq('fuente', 'onu')),
  ]);
  const sha = ((version as { sha256?: string } | null)?.sha256 ?? null) as string | null;
  const faltan = cotejosPendientes(personas, verificaciones as any[], sha);
  if (!faltan.length) return 0;
  const ids = await sincronizarPersonasRelacionadas(expedienteId, e.base.organizacion_id, personas);
  for (const p of faltan) {
    await emitir({
      organizacionId: e.base.organizacion_id,
      expedienteId,
      personaRelacionadaId: ids.get(claveNombre(p.nombre)),
      nombre: p.nombre,
      tipo: p.tipo,
      fechaNacimiento: p.fechaNacimiento,
    }, sha);
  }
  return faltan.length;
}

const PENDIENTE_GENERICO = 'Información adicional requerida por su asesor.';

/**
 * Puerto del agente sobre un expediente. Implementa la frontera del art. 38:
 * no consulta verificaciones, alertas, riesgo ni decisiones, traduce el
 * estado a texto neutro y filtra cualquier pendiente con términos reservados.
 */
export function crearPuerto(
  expedienteId: string,
  eventos: {
    alIdentificar?: (i: Identificacion, version: string | null) => Promise<void>;
    alEnviarARevision: (organizacionId: string) => Promise<void>;
  },
): PuertoExpediente {
  /** M4: el cliente no cambia un expediente ya resuelto; si ya estaba en revisión, se avisa a cumplimiento. */
  const exigirEditable = async () => {
    const base = await cargarBase(expedienteId);
    const politica = politicaEdicion(base.estado_aparente);
    if (politica === 'rechazar') throw new ExpedienteNoEditable(MENSAJE_NO_EDITABLE);
    return { base, politica };
  };
  const despuesDeCambio = async (base: ExpedienteBase, politica: string, que: string) => {
    await sincronizarPendientes(expedienteId);
    await emitirCotejosPendientes(expedienteId, eventos.alIdentificar);
    if (politica === 'permitir_y_avisar') {
      await sinError(db().from('notificaciones').insert({
        organizacion_id: base.organizacion_id,
        destinatario_rol: 'cumplimiento',
        expediente_id: expedienteId,
        prioridad: 'alta',
        asunto: 'El cliente modificó su expediente después de enviarlo',
        cuerpo: `Cambio: ${que}. Revise los datos y vuelva a calcular la evaluación antes de decidir.`,
      }));
    }
  };

  return {
    async vista(): Promise<VistaCliente> {
      const e = await cargarEntradaRevision(expedienteId);
      const pendientes = (await sinError(
        db().from('pendientes').select('tipo, descripcion').eq('expediente_id', expedienteId).eq('estado', 'abierto'),
      )) as { tipo: string; descripcion: string }[];
      const nombreOrganizacion = e.base.organizaciones.marca?.nombre_visible ?? e.base.organizaciones.nombre_comercial;
      return {
        nombreOrganizacion,
        nombreCliente: e.base.contacto_nombre,
        contexto: e.contexto,
        estado: estadoParaCliente[e.base.estado_aparente] ?? 'En revisión',
        datos: Object.entries(e.datos).map(([campo, d]) => ({ campo, valor: d.valor, origen: d.origen, confirmado: d.confirmado })),
        documentos: e.documentos.map((d) => ({ clave: d.clave, estado: d.estado === 'observado' ? 'requiere reenvío' : 'recibido' })),
        // Un pendiente redactado a mano con términos reservados no llega al cliente (art. 38)
        pendientes: pendientes.map((p) => (
          terminoReservado(p.descripcion, [e.base.contacto_nombre, nombreOrganizacion]) ? { tipo: p.tipo, descripcion: PENDIENTE_GENERICO } : p
        )),
      };
    },

    async guardarDato(campo, valor) {
      const { base, politica } = await exigirEditable();
      await sinError(db().rpc('guardar_dato', {
        p_expediente: expedienteId, p_campo: campo, p_valor: valor, p_origen: 'cliente', p_confirmado_por: 'cliente',
      }));
      await despuesDeCambio(base, politica, `dato ${campo}`);
    },

    async confirmarDato(campo) {
      const { base, politica } = await exigirEditable();
      await sinError(db().rpc('confirmar_dato', { p_expediente: expedienteId, p_campo: campo, p_confirmado_por: 'cliente' }));
      await despuesDeCambio(base, politica, `confirmación de ${campo}`);
    },

    async enviarARevision() {
      const r = await sincronizarPendientes(expedienteId);
      // Antes de pasar a revisión, toda persona identificada debe tener su cotejo en curso (A1)
      await emitirCotejosPendientes(expedienteId, eventos.alIdentificar);
      if (!r.completo) return { enviado: false, pendientes: r.pendientes.map((p) => p.descripcion) };
      const base = await cargarBase(expedienteId);
      if (base.estado === 'invitado' || base.estado === 'en_captura') {
        await sinError(db().from('expedientes').update({ estado: 'en_revision' }).eq('id', expedienteId));
        await eventos.alEnviarARevision(base.organizacion_id);
      }
      return { enviado: true, pendientes: [] };
    },
  };
}

/** Crea el puerto con los eventos reales (Inngest). Lo usan WhatsApp y el portal. */
export function crearPuertoConEventos(expedienteId: string): PuertoExpediente {
  return crearPuerto(expedienteId, {
    alEnviarARevision: async (organizacionId) => {
      await inngest.send({ name: 'aml/expediente.enviado_a_revision', data: { organizacionId, expedienteId } });
    },
  });
}
