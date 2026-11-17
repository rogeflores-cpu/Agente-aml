/**
 * Datos que se extraen de cada tipo de documento. El extractor devuelve
 * exactamente estos campos; se guardan como 'doc.<clave>.<campo>' con su
 * página y nivel de confianza.
 */
export interface CampoDocumento {
  nombre: string;
  descripcion: string;
  tipo: 'texto' | 'fecha' | 'numero' | 'lista';
}

const t = (nombre: string, descripcion: string, tipo: CampoDocumento['tipo'] = 'texto'): CampoDocumento => ({ nombre, descripcion, tipo });

const identidad = [
  t('nombre_completo', 'Nombres y apellidos completos'),
  t('cui', 'Código Único de Identificación (13 dígitos)'),
  t('fecha_nacimiento', 'Fecha de nacimiento', 'fecha'),
  t('lugar_nacimiento', 'Lugar de nacimiento'),
  t('nacionalidad', 'Nacionalidad'),
  t('genero', 'Género o sexo'),
  t('estado_civil', 'Estado civil'),
  t('fecha_vencimiento', 'Fecha de vencimiento del documento', 'fecha'),
];

export const ESQUEMAS_DOCUMENTO: Record<string, CampoDocumento[]> = {
  dpi: identidad,
  dpi_representante: identidad,
  pasaporte: [
    t('nombre_completo', 'Nombres y apellidos completos'),
    t('numero', 'Número de pasaporte'),
    t('nacionalidad', 'Nacionalidad'),
    t('pais_emisor', 'País emisor'),
    t('fecha_nacimiento', 'Fecha de nacimiento', 'fecha'),
    t('fecha_vencimiento', 'Fecha de vencimiento', 'fecha'),
  ],
  recibo_servicio: [
    t('titular', 'Nombre del titular del servicio'),
    t('direccion', 'Dirección del servicio'),
    t('fecha_emision', 'Fecha de emisión o del período facturado', 'fecha'),
  ],
  nit_rtu: [
    t('nombre_o_razon_social', 'Nombre o razón social del contribuyente'),
    t('nit', 'Número de Identificación Tributaria'),
    t('domicilio_fiscal', 'Domicilio fiscal'),
    t('fecha_emision', 'Fecha de emisión de la constancia', 'fecha'),
  ],
  patente_empresa: [
    t('nombre', 'Nombre comercial de la empresa'),
    t('propietario', 'Propietario de la empresa'),
    t('registro', 'Número de registro, folio y libro'),
    t('fecha_inscripcion', 'Fecha de inscripción', 'fecha'),
  ],
  patente_sociedad: [
    t('nombre', 'Razón o denominación social'),
    t('registro', 'Número de registro, folio y libro'),
    t('fecha_inscripcion', 'Fecha de inscripción', 'fecha'),
  ],
  escritura_constitutiva: [
    t('razon_social', 'Razón o denominación social'),
    t('fecha_constitucion', 'Fecha de otorgamiento', 'fecha'),
    t('notario', 'Notario autorizante'),
    t('socios_fundadores', 'Socios fundadores con su aportación o porcentaje', 'lista'),
  ],
  nombramiento_representante: [
    t('entidad', 'Entidad que otorga el nombramiento'),
    t('nombre_representante', 'Nombre completo del representante'),
    t('cargo', 'Cargo'),
    t('fecha_vencimiento', 'Fecha en que vence el nombramiento', 'fecha'),
    t('inscripcion', 'Datos de inscripción en el Registro Mercantil'),
  ],
  registro_accionistas: [
    t('entidad', 'Entidad'),
    t('accionistas', 'Accionistas con su porcentaje de participación', 'lista'),
  ],
  certificacion_registral: [
    t('finca', 'Número de finca, folio y libro'),
    t('propietarios', 'Propietarios inscritos', 'lista'),
    t('gravamenes', 'Gravámenes o anotaciones vigentes', 'lista'),
    t('fecha_emision', 'Fecha de emisión de la certificación', 'fecha'),
  ],
  soporte_origen_fondos: [
    t('tipo_soporte', 'Tipo de documento (préstamo, estado de cuenta, compraventa, herencia u otro)'),
    t('emisor', 'Entidad o persona que lo emite'),
    t('beneficiario', 'A nombre de quién está'),
    t('monto', 'Monto', 'numero'),
    t('moneda', 'Moneda'),
    t('fecha', 'Fecha del documento', 'fecha'),
  ],
  poder_representacion: [
    t('otorgante', 'Quien otorga el poder'),
    t('apoderado', 'Quien recibe el poder'),
    t('facultades', 'Facultades otorgadas'),
    t('fecha', 'Fecha de otorgamiento', 'fecha'),
  ],
};

export const TIPOS_DOCUMENTO = Object.keys(ESQUEMAS_DOCUMENTO);
