import { similitudNombres, tokensEntidad, tokensPersona } from '@agente-aml/listas';
import { camposPara, documentosPara, type Contexto } from './catalogo.js';
import { interpretarBeneficiarios } from './identificacion.js';

export interface Dato {
  valor: unknown;
  origen: 'cliente' | 'documento' | 'fuente_externa' | 'revisor';
  confirmado: boolean;
}

export interface DocumentoRecibido {
  clave: string;
  estado: 'recibido' | 'extraido' | 'confirmado' | 'observado' | 'rechazado';
  motivo?: string;
}

export interface EntradaRevision {
  contexto: Contexto;
  /** Datos vigentes por campo: 'cliente.nombre_completo', 'doc.dpi.cui', etc. */
  datos: Record<string, Dato>;
  documentos: DocumentoRecibido[];
  hoy?: Date;
}

export interface PendienteRevision {
  tipo: 'faltante' | 'ilegible' | 'vencido' | 'contradiccion' | 'aclaracion';
  referencia: string;
  /** Texto para el cliente. Neutro. */
  descripcion: string;
}

export interface ResultadoRevision {
  pendientes: PendienteRevision[];
  completo: boolean;
  avance: { campos: [number, number]; documentos: [number, number] };
}

const vacio = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);
const texto = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const digitos = (v: unknown) => texto(v).replace(/\D/g, '');
const fecha = (v: unknown): Date | null => {
  const s = texto(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const d = iso ? new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`) : dmy ? new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1])) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const mismoNombre = (a: unknown, b: unknown, entidad = false) => {
  const tk = entidad ? tokensEntidad : tokensPersona;
  return similitudNombres(tk(texto(a)), tk(texto(b))) >= 0.9;
};

/** Pares dato del documento ↔ dato declarado que deben coincidir. */
const COMPARACIONES: { doc: string; declarado: string; como: 'nombre' | 'entidad' | 'digitos' | 'fecha'; descripcion: string }[] = [
  { doc: 'doc.dpi.nombre_completo', declarado: 'cliente.nombre_completo', como: 'nombre', descripcion: 'El nombre que escribió no coincide con el de su DPI. ¿Puede confirmarlo?' },
  { doc: 'doc.dpi.cui', declarado: 'cliente.documento_numero', como: 'digitos', descripcion: 'El número de documento que indicó no coincide con el de su DPI. ¿Puede revisarlo?' },
  { doc: 'doc.dpi.fecha_nacimiento', declarado: 'cliente.fecha_nacimiento', como: 'fecha', descripcion: 'La fecha de nacimiento no coincide con la de su DPI. ¿Puede confirmarla?' },
  { doc: 'doc.pasaporte.nombre_completo', declarado: 'cliente.nombre_completo', como: 'nombre', descripcion: 'El nombre que escribió no coincide con el de su pasaporte. ¿Puede confirmarlo?' },
  { doc: 'doc.pasaporte.numero', declarado: 'cliente.documento_numero', como: 'digitos', descripcion: 'El número de documento no coincide con el de su pasaporte. ¿Puede revisarlo?' },
  { doc: 'doc.nit_rtu.nit', declarado: 'entidad.nit', como: 'digitos', descripcion: 'El NIT indicado no coincide con el de la constancia de RTU.' },
  { doc: 'doc.patente_sociedad.nombre', declarado: 'entidad.razon_social', como: 'entidad', descripcion: 'La razón social indicada no coincide con la de la patente de sociedad.' },
  { doc: 'doc.nombramiento_representante.nombre_representante', declarado: 'representante.nombre_completo', como: 'nombre', descripcion: 'El nombre del representante no coincide con el del nombramiento.' },
  { doc: 'doc.dpi_representante.nombre_completo', declarado: 'representante.nombre_completo', como: 'nombre', descripcion: 'El nombre del representante no coincide con el de su DPI.' },
  { doc: 'doc.dpi_representante.cui', declarado: 'representante.documento_numero', como: 'digitos', descripcion: 'El documento del representante no coincide con el de su DPI.' },
];

/** Documentos con vigencia: campo de fecha y cómo se evalúa. */
const VIGENCIAS: { doc: string; campo: string; tipo: 'vencimiento' | 'antiguedad'; dias?: number; descripcion: string }[] = [
  { doc: 'dpi', campo: 'fecha_vencimiento', tipo: 'vencimiento', descripcion: 'Su DPI está vencido. Por favor envíe un documento vigente.' },
  { doc: 'pasaporte', campo: 'fecha_vencimiento', tipo: 'vencimiento', descripcion: 'Su pasaporte está vencido. Por favor envíe un documento vigente.' },
  { doc: 'dpi_representante', campo: 'fecha_vencimiento', tipo: 'vencimiento', descripcion: 'El DPI del representante está vencido.' },
  { doc: 'nombramiento_representante', campo: 'fecha_vencimiento', tipo: 'vencimiento', descripcion: 'El nombramiento del representante legal está vencido.' },
  { doc: 'recibo_servicio', campo: 'fecha_emision', tipo: 'antiguedad', dias: 90, descripcion: 'El recibo tiene más de 3 meses. Por favor envíe uno más reciente.' },
  { doc: 'certificacion_registral', campo: 'fecha_emision', tipo: 'antiguedad', dias: 90, descripcion: 'La certificación del Registro tiene más de 3 meses. Por favor envíe una reciente.' },
];

/**
 * Revisión determinista del expediente: faltantes, ilegibles, vencidos y
 * contradicciones entre lo declarado y los documentos. No usa IA.
 */
export function revisar(e: EntradaRevision): ResultadoRevision {
  const hoy = e.hoy ?? new Date();
  const pendientes: PendienteRevision[] = [];
  const valor = (campo: string) => e.datos[campo]?.valor;

  // Campos
  const campos = camposPara(e.contexto).filter((c) => !c.opcional);
  let camposListos = 0;
  for (const c of campos) {
    const d = e.datos[c.campo];
    if (vacio(d?.valor)) {
      pendientes.push({ tipo: 'faltante', referencia: c.campo, descripcion: c.etiqueta });
    } else if (d.origen === 'documento' && !d.confirmado) {
      // Leído de un documento y aún no confirmado por el cliente: no cuenta como completo
      // (el nombre del cliente, en especial, debe estar confirmado antes de revisar).
      pendientes.push({ tipo: 'aclaracion', referencia: c.campo, descripcion: `Confirme el dato leído de su documento: ${c.etiqueta}.` });
    } else {
      camposListos++;
    }
  }

  // Beneficiarios finales (art. 2 b): nombre, documento y 15 % o más, o control por otro medio
  if (e.contexto.tipoPersona !== 'individual' && !vacio(valor('beneficiarios_finales'))) {
    const lista = interpretarBeneficiarios(valor('beneficiarios_finales'));
    const incompletos = lista.filter((b) => !b.documento || (b.porcentaje === undefined && !b.controlPorOtroMedio));
    const bajoUmbral = lista.filter((b) => b.porcentaje !== undefined && b.porcentaje < 15 && !b.controlPorOtroMedio);
    if (!lista.length || incompletos.length) {
      pendientes.push({
        tipo: 'aclaracion',
        referencia: 'beneficiarios_finales',
        descripcion: 'Para cada beneficiario final indique nombre completo, número de documento y porcentaje de participación (o si ejerce el control por otro medio).',
      });
    }
    if (bajoUmbral.length) {
      pendientes.push({
        tipo: 'aclaracion',
        referencia: 'beneficiarios_finales',
        descripcion: `Indicó personas con menos del 15 % (${bajoUmbral.map((b) => b.nombre).join(', ')}). Confirme si ejercen el control de la entidad por otro medio o indique quiénes tienen el 15 % o más.`,
      });
    }
  }

  // Documentos
  const requeridos = documentosPara(e.contexto);
  let docsListos = 0;
  for (const d of requeridos) {
    const recibidos = e.documentos.filter((x) => x.clave === d.clave || d.alternativas?.includes(x.clave));
    const util = recibidos.find((x) => x.estado !== 'observado' && x.estado !== 'rechazado');
    if (util) {
      docsListos++;
      continue;
    }
    const observado = recibidos.find((x) => x.estado === 'observado');
    pendientes.push(
      observado
        ? { tipo: 'ilegible', referencia: d.clave, descripcion: `${d.nombre}: ${observado.motivo ?? 'no se pudo leer bien. ¿Puede enviarlo de nuevo con mejor luz y sin cortes?'}` }
        : { tipo: 'faltante', referencia: d.clave, descripcion: d.nombre },
    );
  }

  // Vigencia
  for (const v of VIGENCIAS) {
    const f = fecha(valor(`doc.${v.doc}.${v.campo}`));
    if (!f) continue;
    const vencido = v.tipo === 'vencimiento' ? f < hoy : (hoy.getTime() - f.getTime()) / 86_400_000 > (v.dias ?? 90);
    if (vencido) pendientes.push({ tipo: 'vencido', referencia: v.doc, descripcion: v.descripcion });
  }

  // Contradicciones
  for (const c of COMPARACIONES) {
    const a = valor(c.doc);
    const b = valor(c.declarado);
    if (vacio(a) || vacio(b)) continue;
    const coincide =
      c.como === 'nombre' ? mismoNombre(a, b)
      : c.como === 'entidad' ? mismoNombre(a, b, true)
      : c.como === 'digitos' ? digitos(a) === digitos(b)
      : fecha(a)?.getTime() === fecha(b)?.getTime();
    if (!coincide) pendientes.push({ tipo: 'contradiccion', referencia: c.declarado, descripcion: c.descripcion });
  }

  // Vendedor: el titular registral debe ser el cliente
  if (e.contexto.parte === 'vendedor') {
    const propietarios = valor('doc.certificacion_registral.propietarios');
    const cliente = e.contexto.tipoPersona === 'individual' ? valor('cliente.nombre_completo') : valor('entidad.razon_social');
    if (Array.isArray(propietarios) && propietarios.length && !vacio(cliente)) {
      const esTitular = propietarios.some((p) => mismoNombre(p, cliente, e.contexto.tipoPersona !== 'individual'));
      if (!esTitular) {
        pendientes.push({
          tipo: 'aclaracion',
          referencia: 'certificacion_registral',
          descripcion: 'El inmueble aparece inscrito a nombre de otra persona. ¿Puede explicar su relación con el propietario registral?',
        });
      }
    }
  }

  // Comprador: si paga otra persona, se debe identificar
  if (e.contexto.parte === 'comprador') {
    if (valor('origen_fondos.pagador') === 'otra persona o empresa' && vacio(valor('origen_fondos.pagador_identificacion'))) {
      pendientes.push({
        tipo: 'aclaracion',
        referencia: 'origen_fondos.pagador_identificacion',
        descripcion: 'Indicó que otra persona o empresa hará el pago. Necesitamos su nombre completo, documento de identificación y su relación con usted.',
      });
    }
  }

  return {
    pendientes,
    completo: pendientes.length === 0,
    avance: { campos: [camposListos, campos.length], documentos: [docsListos, requeridos.length] },
  };
}
