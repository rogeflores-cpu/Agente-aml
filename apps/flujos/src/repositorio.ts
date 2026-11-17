import {
  CAMPOS_IDENTIFICACION,
  revisar,
  type Contexto,
  type Dato,
  type EntradaRevision,
  type PuertoExpediente,
  type VistaCliente,
} from '@agente-aml/agente';
import { db, sinError } from './datos.js';
import { estadoParaCliente } from './plantillas.js';

interface ExpedienteBase {
  id: string;
  organizacion_id: string;
  parte: 'comprador' | 'vendedor';
  tipo_persona: 'individual' | 'juridica' | 'estructura';
  estado: string;
  contacto_nombre: string;
  organizaciones: { nombre_comercial: string; marca: { nombre_visible?: string } | null };
}

async function cargarBase(expedienteId: string): Promise<ExpedienteBase> {
  return (await sinError(
    db().from('expedientes')
      .select('id, organizacion_id, parte, tipo_persona, estado, contacto_nombre, organizaciones(nombre_comercial, marca)')
      .eq('id', expedienteId).single(),
  )) as unknown as ExpedienteBase;
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
 * cierra los que ya no aplican y agrega los nuevos.
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
  return resultado;
}

export interface Identificacion {
  organizacionId: string;
  expedienteId: string;
  nombre: string;
  tipo: 'individual' | 'entidad';
  fechaNacimiento?: string;
}

/**
 * Puerto del agente sobre un expediente. Implementa la frontera del art. 38:
 * no consulta verificaciones, alertas, riesgo ni decisiones, y traduce el
 * estado a texto neutro.
 */
export function crearPuerto(
  expedienteId: string,
  eventos: {
    alIdentificar: (i: Identificacion) => Promise<void>;
    alEnviarARevision: (organizacionId: string) => Promise<void>;
  },
): PuertoExpediente {
  const identificarSiCorresponde = async (campo: string) => {
    if (campo === 'beneficiarios_finales') {
      const e = await cargarEntradaRevision(expedienteId);
      const lista = e.datos[campo]?.valor;
      for (const b of Array.isArray(lista) ? lista : []) {
        const nombre = typeof b === 'string' ? b : (b as { nombre?: string })?.nombre;
        if (nombre) {
          await eventos.alIdentificar({ organizacionId: e.base.organizacion_id, expedienteId, nombre, tipo: 'individual' });
        }
      }
      return;
    }
    const tipo = CAMPOS_IDENTIFICACION[campo];
    if (!tipo) return;
    const e = await cargarEntradaRevision(expedienteId);
    const dato = e.datos[campo];
    if (!dato?.confirmado || !dato.valor) return;
    const fecha = e.datos['cliente.fecha_nacimiento'];
    await eventos.alIdentificar({
      organizacionId: e.base.organizacion_id,
      expedienteId,
      nombre: String(dato.valor),
      tipo,
      fechaNacimiento: campo === 'cliente.nombre_completo' && fecha?.valor ? String(fecha.valor) : undefined,
    });
  };

  return {
    async vista(): Promise<VistaCliente> {
      const e = await cargarEntradaRevision(expedienteId);
      const pendientes = await sinError(
        db().from('pendientes').select('tipo, descripcion').eq('expediente_id', expedienteId).eq('estado', 'abierto'),
      );
      return {
        nombreOrganizacion: e.base.organizaciones.marca?.nombre_visible ?? e.base.organizaciones.nombre_comercial,
        nombreCliente: e.base.contacto_nombre,
        contexto: e.contexto,
        estado: estadoParaCliente[e.base.estado] ?? 'En revisión',
        datos: Object.entries(e.datos).map(([campo, d]) => ({ campo, valor: d.valor, origen: d.origen, confirmado: d.confirmado })),
        documentos: e.documentos.map((d) => ({ clave: d.clave, estado: d.estado === 'observado' ? 'requiere reenvío' : 'recibido' })),
        pendientes: pendientes as { tipo: string; descripcion: string }[],
      };
    },

    async guardarDato(campo, valor) {
      await sinError(db().rpc('guardar_dato', {
        p_expediente: expedienteId, p_campo: campo, p_valor: valor, p_origen: 'cliente', p_confirmado_por: 'cliente',
      }));
      await sincronizarPendientes(expedienteId);
      await identificarSiCorresponde(campo);
    },

    async confirmarDato(campo) {
      await sinError(db().rpc('confirmar_dato', { p_expediente: expedienteId, p_campo: campo, p_confirmado_por: 'cliente' }));
      await sincronizarPendientes(expedienteId);
      await identificarSiCorresponde(campo);
    },

    async enviarARevision() {
      const r = await sincronizarPendientes(expedienteId);
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
