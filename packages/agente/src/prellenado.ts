/**
 * Datos del expediente que se pueden prellenar con lo leído de un documento,
 * para que el cliente solo confirme en lugar de escribir.
 */
const MAPA: Record<string, Record<string, string>> = {
  dpi: {
    nombre_completo: 'cliente.nombre_completo',
    cui: 'cliente.documento_numero',
    fecha_nacimiento: 'cliente.fecha_nacimiento',
    lugar_nacimiento: 'cliente.lugar_nacimiento',
    nacionalidad: 'cliente.nacionalidad',
    estado_civil: 'cliente.estado_civil',
  },
  pasaporte: {
    nombre_completo: 'cliente.nombre_completo',
    numero: 'cliente.documento_numero',
    fecha_nacimiento: 'cliente.fecha_nacimiento',
    nacionalidad: 'cliente.nacionalidad',
  },
  recibo_servicio: { direccion: 'cliente.direccion_residencia' },
  nit_rtu: { nit: 'entidad.nit', domicilio_fiscal: 'entidad.domicilio_fiscal' },
  patente_sociedad: { nombre: 'entidad.razon_social' },
  patente_empresa: { nombre: 'entidad.nombre_comercial' },
  escritura_constitutiva: { razon_social: 'entidad.razon_social', fecha_constitucion: 'entidad.fecha_constitucion' },
  nombramiento_representante: { nombre_representante: 'representante.nombre_completo' },
  dpi_representante: { nombre_completo: 'representante.nombre_completo', cui: 'representante.documento_numero' },
};

const TIPO_DOCUMENTO_IDENTIDAD: Record<string, string> = { dpi: 'DPI', pasaporte: 'pasaporte' };

export interface Prellenado {
  campo: string;
  valor: unknown;
  campoDocumento: string;
}

/**
 * Propone valores para los campos del expediente a partir de un documento.
 * Nunca sobrescribe lo que el cliente ya declaró: esas diferencias las detecta
 * el revisor como contradicciones.
 */
export function prellenar(
  tipoDocumento: string,
  campos: Record<string, { valor: unknown }>,
  yaRegistrados: Set<string>,
): Prellenado[] {
  const mapa = MAPA[tipoDocumento] ?? {};
  const salida: Prellenado[] = [];
  for (const [campoDoc, campoExpediente] of Object.entries(mapa)) {
    const valor = campos[campoDoc]?.valor;
    if (valor === null || valor === undefined || valor === '' || yaRegistrados.has(campoExpediente)) continue;
    salida.push({ campo: campoExpediente, valor, campoDocumento: campoDoc });
  }
  const tipoId = TIPO_DOCUMENTO_IDENTIDAD[tipoDocumento];
  if (tipoId && salida.some((p) => p.campo === 'cliente.documento_numero') && !yaRegistrados.has('cliente.documento_tipo')) {
    salida.push({ campo: 'cliente.documento_tipo', valor: tipoId, campoDocumento: 'tipo' });
  }
  return salida;
}

/** Campos cuyo valor confirmado identifica a una persona y dispara el cotejo con listas. */
export const CAMPOS_IDENTIFICACION: Record<string, 'individual' | 'entidad'> = {
  'cliente.nombre_completo': 'individual',
  'entidad.razon_social': 'entidad',
  'representante.nombre_completo': 'individual',
};
