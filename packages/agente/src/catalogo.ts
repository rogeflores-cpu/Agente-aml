/**
 * Catálogo de información y documentos que se piden al cliente de una
 * inmobiliaria, según la parte (comprador o vendedor) y el tipo de persona.
 * Base: art. 21 numerales 1 a 4 (identificar y verificar al cliente y a quien
 * actúa en su nombre, identificar al beneficiario final, conocer el propósito
 * de la relación y establecer el perfil) y art. 25 a (personas expuestas
 * políticamente). Los datos de identificación siguen como referencia la lista
 * del art. 42 b, que es la del régimen especial de profesionales y notarios:
 * para las inmobiliarias (régimen general, art. 3 c 1 i) no es fundamento
 * legal sino un mínimo razonable, hasta que el reglamento fije los datos. El reglamento puede
 * ampliarlos; el catálogo es el único lugar donde se cambian.
 *
 * Los textos de "pregunta" y "explicacion" los ve el cliente: deben ser neutros.
 */

export interface Contexto {
  parte: 'comprador' | 'vendedor';
  tipoPersona: 'individual' | 'juridica' | 'estructura';
  /** true si el cliente declaró nacionalidad distinta de la guatemalteca. */
  extranjero?: boolean;
  /** true si quien atiende actúa en nombre del cliente. */
  actuaPorRepresentacion?: boolean;
}

export interface Campo {
  campo: string;
  etiqueta: string;
  pregunta: string;
  tipo: 'texto' | 'fecha' | 'opcion' | 'si_no' | 'lista';
  opciones?: string[];
  /** Se pide solo cuando otra respuesta lo hace necesario; no cuenta como faltante. */
  opcional?: boolean;
  /** Formato esperado del valor (para campos de tipo lista). */
  formato?: string;
  aplica: (c: Contexto) => boolean;
}

export interface Documento {
  clave: string;
  nombre: string;
  explicacion: string;
  /** Claves que lo sustituyen (por ejemplo, pasaporte en lugar de DPI). */
  alternativas?: string[];
  aplica: (c: Contexto) => boolean;
}

const siempre = () => true;
const individual = (c: Contexto) => c.tipoPersona === 'individual';
const juridica = (c: Contexto) => c.tipoPersona !== 'individual';
const comprador = (c: Contexto) => c.parte === 'comprador';

export const CAMPOS: Campo[] = [
  // Persona individual: identificación (art. 21 numeral 1; lista de referencia del art. 42 b i)
  { campo: 'cliente.nombre_completo', etiqueta: 'Nombre completo', pregunta: '¿Cuál es su nombre completo, tal como aparece en su documento de identificación?', tipo: 'texto', aplica: individual },
  { campo: 'cliente.fecha_nacimiento', etiqueta: 'Fecha de nacimiento', pregunta: '¿Cuál es su fecha de nacimiento?', tipo: 'fecha', aplica: individual },
  { campo: 'cliente.lugar_nacimiento', etiqueta: 'Lugar de nacimiento', pregunta: '¿En qué lugar nació?', tipo: 'texto', aplica: individual },
  { campo: 'cliente.nacionalidad', etiqueta: 'Nacionalidad', pregunta: '¿Cuál es su nacionalidad?', tipo: 'texto', aplica: individual },
  { campo: 'cliente.genero', etiqueta: 'Género', pregunta: '¿Cuál es su género?', tipo: 'opcion', opciones: ['femenino', 'masculino'], aplica: individual },
  { campo: 'cliente.estado_civil', etiqueta: 'Estado civil', pregunta: '¿Cuál es su estado civil?', tipo: 'opcion', opciones: ['soltero', 'casado', 'unido de hecho', 'divorciado', 'viudo'], aplica: individual },
  { campo: 'cliente.profesion', etiqueta: 'Profesión u oficio', pregunta: '¿Cuál es su profesión u oficio?', tipo: 'texto', aplica: individual },
  { campo: 'cliente.documento_tipo', etiqueta: 'Tipo de documento', pregunta: '¿Se identifica con DPI o con pasaporte?', tipo: 'opcion', opciones: ['DPI', 'pasaporte'], aplica: individual },
  { campo: 'cliente.documento_numero', etiqueta: 'Número de documento', pregunta: '¿Cuál es el número de su documento de identificación?', tipo: 'texto', aplica: individual },
  { campo: 'cliente.direccion_residencia', etiqueta: 'Dirección de residencia', pregunta: '¿Cuál es su dirección de residencia completa?', tipo: 'texto', aplica: individual },
  { campo: 'cliente.condicion_migratoria', etiqueta: 'Condición migratoria', pregunta: '¿Cuál es su condición migratoria en Guatemala?', tipo: 'texto', aplica: (c) => individual(c) && !!c.extranjero },
  { campo: 'cliente.actividad_economica', etiqueta: 'Actividad económica', pregunta: '¿A qué se dedica principalmente y dónde trabaja?', tipo: 'texto', aplica: individual },
  { campo: 'cliente.ingresos_rango', etiqueta: 'Ingresos mensuales aproximados', pregunta: '¿En qué rango están sus ingresos mensuales?', tipo: 'opcion', opciones: ['hasta Q10,000', 'Q10,001 a Q30,000', 'Q30,001 a Q75,000', 'más de Q75,000'], aplica: individual },
  { campo: 'cliente.cargo_publico', etiqueta: 'Cargo público', pregunta: '¿Ocupa usted, o ha ocupado en el último año, un cargo público de alto nivel en Guatemala o en otro país, o una función de dirección en un organismo internacional?', tipo: 'si_no', aplica: individual },
  { campo: 'cliente.familiar_cargo_publico', etiqueta: 'Familiar o socio con cargo público', pregunta: '¿Su cónyuge o conviviente, sus padres o hijos, o algún socio cercano ocupa o ha ocupado en el último año un cargo así?', tipo: 'si_no', aplica: individual },

  // Persona jurídica o estructura (art. 21 numerales 1 y 2; lista de referencia del art. 42 b ii)
  { campo: 'entidad.razon_social', etiqueta: 'Razón o denominación social', pregunta: '¿Cuál es la razón social de la entidad?', tipo: 'texto', aplica: juridica },
  { campo: 'entidad.nombre_comercial', etiqueta: 'Nombre comercial', pregunta: '¿Cuál es su nombre comercial?', tipo: 'texto', aplica: juridica },
  { campo: 'entidad.tipo', etiqueta: 'Tipo de entidad', pregunta: '¿Qué tipo de entidad es (sociedad anónima, fundación, fideicomiso u otra)?', tipo: 'texto', aplica: juridica },
  { campo: 'entidad.inscripcion_registral', etiqueta: 'Datos de inscripción', pregunta: '¿Cuáles son sus datos de inscripción en el Registro Mercantil (número, folio y libro)?', tipo: 'texto', aplica: juridica },
  { campo: 'entidad.nit', etiqueta: 'NIT', pregunta: '¿Cuál es el NIT de la entidad?', tipo: 'texto', aplica: juridica },
  { campo: 'entidad.fecha_constitucion', etiqueta: 'Fecha de constitución', pregunta: '¿En qué fecha se constituyó?', tipo: 'fecha', aplica: juridica },
  { campo: 'entidad.lugar_constitucion', etiqueta: 'Lugar de constitución', pregunta: '¿En qué país y lugar se constituyó?', tipo: 'texto', aplica: juridica },
  { campo: 'entidad.domicilio_fiscal', etiqueta: 'Domicilio fiscal', pregunta: '¿Cuál es su domicilio fiscal?', tipo: 'texto', aplica: juridica },
  { campo: 'entidad.actividad', etiqueta: 'Actividad principal', pregunta: '¿A qué se dedica la entidad?', tipo: 'texto', aplica: juridica },
  { campo: 'representante.nombre_completo', etiqueta: 'Representante legal', pregunta: '¿Quién es el representante legal y cuál es su nombre completo?', tipo: 'texto', aplica: juridica },
  { campo: 'representante.documento_numero', etiqueta: 'Documento del representante', pregunta: '¿Cuál es el número de DPI o pasaporte del representante legal?', tipo: 'texto', aplica: juridica },
  { campo: 'representante.cargo_publico', etiqueta: 'Cargo público del representante', pregunta: '¿El representante legal ocupa, o ha ocupado en el último año, un cargo público de alto nivel en Guatemala o en otro país, o una función de dirección en un organismo internacional? ¿Es cónyuge, conviviente, padre, madre, hijo o socio cercano de alguien que lo sea?', tipo: 'si_no', aplica: juridica },
  { campo: 'beneficiarios_finales', etiqueta: 'Beneficiarios finales', pregunta: '¿Qué personas son dueñas, directa o indirectamente, del 15 % o más de la entidad, o la controlan por otro medio? Indique nombre, documento y porcentaje de cada una.', tipo: 'lista', formato: 'Arreglo de objetos {"nombre", "documento", "porcentaje" (número), "control_por_otro_medio" (true si controla sin llegar al 15 %)}', aplica: juridica },
  { campo: 'beneficiarios_finales.cargo_publico', etiqueta: 'Cargo público de beneficiarios finales', pregunta: '¿Alguno de los beneficiarios finales ocupa, o ha ocupado en el último año, un cargo público de alto nivel en Guatemala o en otro país, o una función de dirección en un organismo internacional, o es cónyuge, conviviente, padre, madre, hijo o socio cercano de alguien que lo sea?', tipo: 'si_no', aplica: juridica },

  // Ambas partes
  { campo: 'relacion.proposito', etiqueta: 'Propósito de la operación', pregunta: '¿Para qué destinará el inmueble (vivienda, inversión, negocio u otro)?', tipo: 'texto', aplica: comprador },
  { campo: 'relacion.proposito', etiqueta: 'Motivo de la venta', pregunta: '¿Cuál es el motivo de la venta?', tipo: 'texto', aplica: (c) => c.parte === 'vendedor' },
  { campo: 'contacto.telefono', etiqueta: 'Teléfono', pregunta: '¿A qué número podemos contactarle?', tipo: 'texto', aplica: siempre },
  { campo: 'contacto.correo', etiqueta: 'Correo electrónico', pregunta: '¿Cuál es su correo electrónico?', tipo: 'texto', aplica: siempre },

  // Origen de fondos: solo comprador (decisión 11/11/2026)
  { campo: 'origen_fondos.descripcion', etiqueta: 'Origen de los fondos', pregunta: '¿De dónde provienen los fondos con que pagará el inmueble (ahorros, venta de otro bien, préstamo bancario, herencia u otro)?', tipo: 'texto', aplica: comprador },
  { campo: 'origen_fondos.forma_pago', etiqueta: 'Forma de pago', pregunta: '¿Cómo realizará el pago (transferencia, cheque, financiamiento bancario, efectivo u otro) y desde qué país?', tipo: 'texto', aplica: comprador },
  { campo: 'origen_fondos.pagador', etiqueta: 'Quién paga', pregunta: '¿El pago lo hará usted directamente o otra persona o empresa?', tipo: 'opcion', opciones: ['el cliente', 'otra persona o empresa'], aplica: comprador },
  { campo: 'origen_fondos.pagador_identificacion', etiqueta: 'Datos de quien paga', pregunta: 'Indique el nombre completo, documento de identificación y relación con usted de quien hará el pago.', tipo: 'texto', opcional: true, aplica: comprador },
];

export const DOCUMENTOS: Documento[] = [
  { clave: 'dpi', nombre: 'DPI (ambos lados)', explicacion: 'Para confirmar su identidad.', alternativas: ['pasaporte'], aplica: individual },
  { clave: 'recibo_servicio', nombre: 'Recibo de agua, luz o teléfono reciente', explicacion: 'Para confirmar su dirección de residencia.', aplica: individual },
  { clave: 'nit_rtu', nombre: 'Constancia de RTU o NIT', explicacion: 'Para confirmar sus datos tributarios.', aplica: siempre },
  { clave: 'patente_empresa', nombre: 'Patente de comercio de empresa', explicacion: 'Para confirmar la inscripción de la entidad.', aplica: juridica },
  { clave: 'patente_sociedad', nombre: 'Patente de comercio de sociedad', explicacion: 'Para confirmar la inscripción de la entidad.', aplica: juridica },
  { clave: 'escritura_constitutiva', nombre: 'Escritura de constitución y sus modificaciones', explicacion: 'Para conocer la estructura de la entidad.', aplica: juridica },
  { clave: 'nombramiento_representante', nombre: 'Nombramiento del representante legal inscrito', explicacion: 'Para confirmar quién puede actuar por la entidad.', aplica: juridica },
  { clave: 'dpi_representante', nombre: 'DPI del representante legal', explicacion: 'Para confirmar la identidad de quien firma.', aplica: juridica },
  { clave: 'registro_accionistas', nombre: 'Registro de accionistas o declaración de beneficiarios finales', explicacion: 'Para identificar a los dueños de la entidad.', aplica: juridica },
  { clave: 'certificacion_registral', nombre: 'Certificación del Registro de la Propiedad del inmueble', explicacion: 'Para confirmar la titularidad del inmueble.', aplica: (c) => c.parte === 'vendedor' },
  { clave: 'soporte_origen_fondos', nombre: 'Documento que respalde el origen de los fondos', explicacion: 'Por ejemplo: carta de aprobación de préstamo, estado de cuenta o escritura de venta de otro bien.', aplica: comprador },
  { clave: 'poder_representacion', nombre: 'Poder o mandato de quien actúa en su nombre', explicacion: 'Para confirmar que puede actuar en su representación.', aplica: (c) => !!c.actuaPorRepresentacion },
];

export const camposPara = (c: Contexto) => CAMPOS.filter((x) => x.aplica(c));
export const documentosPara = (c: Contexto) => DOCUMENTOS.filter((x) => x.aplica(c));
export const campoValido = (c: Contexto, campo: string) => camposPara(c).find((x) => x.campo === campo);
