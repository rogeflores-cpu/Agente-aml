export type Nivel = 'bajo' | 'medio' | 'alto';
export type Medidas = 'simplificada' | 'estandar' | 'intensificada';
export type Factor = 'cliente' | 'geografia' | 'canal' | 'producto';

export type MedioPago =
  | 'efectivo'
  | 'transferencia_local'
  | 'transferencia_exterior'
  | 'cheque'
  | 'financiamiento_bancario'
  | 'activos_virtuales'
  | 'otro';

export interface Pago {
  medio: MedioPago;
  /** Monto convertido a USD con el tipo de cambio del día. */
  montoUsd: number;
  /** false cuando paga un tercero distinto del cliente. */
  pagadorEsCliente: boolean;
  /** País de origen de los fondos, ISO 3166-1 alfa-2. */
  paisOrigen?: string;
  /** Fecha del pago (AAAA-MM-DD), para agrupar efectivo por día (art. 31). */
  fecha?: string;
}

/** Datos del expediente que entran al cálculo. Se guarda tal cual en evaluaciones_riesgo.entrada. */
export interface PerfilEvaluacion {
  parte: 'comprador' | 'vendedor';
  tipoPersona: 'individual' | 'juridica' | 'estructura';

  // Factor cliente
  esPep: boolean;
  /** Pariente en primer grado, cónyuge o conviviente, o asociado cercano de un PEP. */
  vinculoPep: boolean;
  contratistaOProveedorEstado: boolean;
  sinFinesDeLucro: boolean;
  fideicomiso: boolean;
  /** Ninguna de las partes de la relación domiciliada en el país (art. 25 e). */
  noDomiciliado: boolean;
  antiguedadSociedadMeses?: number;
  /** Capas de propiedad hasta llegar al beneficiario final. */
  nivelesPropiedad?: number;
  /** Para personas jurídicas y estructuras. En personas individuales se ignora. */
  beneficiarioFinalIdentificado: boolean;
  /** Clave de actividad económica (por ejemplo, código CIIU). */
  actividadEconomica?: string;
  /** Coherencia entre el perfil económico declarado y el monto de la operación. */
  coherenciaPerfilMonto?: 'coherente' | 'dudosa' | 'incoherente';

  // Factor geográfico
  nacionalidad?: string;
  paisResidencia?: string;
  departamentoInmueble?: string;

  // Factor canal
  presencial: boolean;
  intermediario: boolean;
  actuaPorRepresentacion: boolean;

  // Factor producto u operación
  tipoOperacion: 'compraventa' | 'intermediacion';
  precioUsd?: number;
  valorReferenciaUsd?: number;
  pagos: Pago[];
  /** Solo vendedor: días desde que adquirió el inmueble. */
  diasDesdeAdquisicion?: number;

  // Estado de la debida diligencia
  /** Exigible solo al comprador (decisión de diseño 11/11/2026). */
  origenFondosDeclarado: boolean;
  ddcCompleta: boolean;
  transaccionInusual: boolean;
  /** Resultado del cotejo con listas del Consejo de Seguridad de la ONU (art. 43). */
  coincidenciaOnu: 'ninguna' | 'posible' | 'confirmada';
  /**
   * Resultado del cotejo con la lista SDN de OFAC (EE. UU.). No es lista del
   * art. 43: no bloquea ni se comunica al MP; eleva el riesgo y exige
   * debida diligencia intensificada. Sin dato equivale a 'ninguna'.
   */
  coincidenciaOfac?: 'ninguna' | 'posible' | 'confirmada';
}

export interface ConfiguracionRiesgo {
  version: number;
  /** Peso de cada factor en el puntaje total. Deben sumar 1. */
  pesosFactores: Record<Factor, number>;
  /** Puntaje total (0 a 100) a partir del cual el nivel es medio o alto. */
  umbrales: { medio: number; alto: number };
  /** Puntos por variable. Cada factor se limita a 100. */
  puntos: Record<string, number>;
  /** Países de alto riesgo según el GAFI (llamado a la acción), ISO alfa-2. Se actualiza con cada publicación. */
  paisesAltoRiesgoGafi: string[];
  /** Países bajo monitoreo intensificado del GAFI, ISO alfa-2. */
  paisesMonitoreoGafi: string[];
  /** Puntos adicionales por departamento del inmueble (nombre normalizado en minúsculas). */
  departamentos: Record<string, number>;
  /** Puntos adicionales por actividad económica. */
  actividades: Record<string, number>;
  nivelMinimoPep: Nivel;
  /** Desviación relativa entre precio y valor de referencia que dispara alerta (0.3 = 30 %). */
  desviacionPrecio: number;
  reventaRapidaDias: number;
  sociedadRecienteMeses: number;
  /** Art. 31: USD 10,000 por día, en una o varias transacciones. */
  umbralEfectivoUsd: number;
  permitirSimplificada: boolean;
  /** Meses para la siguiente actualización por nivel. Alto: máximo 12 (art. 22). */
  actualizacionMeses: Record<Nivel, number>;
}

export interface ReglaImpuesta {
  codigo: string;
  descripcion: string;
  fundamento: string;
  nivelMinimo?: Nivel;
  medidas?: Medidas;
  bloqueo?: boolean;
}

export interface Senal {
  codigo: string;
  descripcion: string;
  evidencia?: Record<string, unknown>;
}

export type Propuesta =
  | 'bloquear_y_comunicar_mp'
  | 'resolver_coincidencia'
  | 'proponer_abstencion'
  | 'listo_para_decision';

export interface ResultadoEvaluacion {
  configuracionVersion: number;
  puntajes: Record<Factor, number>;
  puntajeTotal: number;
  nivelPorPuntaje: Nivel;
  nivel: Nivel;
  medidas: Medidas;
  reglas: ReglaImpuesta[];
  senales: Senal[];
  /** Literales del art. 25 que aplican. */
  situacionesEspeciales: string[];
  registroEfectivo: { requerido: boolean; totalMaximoDiarioUsd: number };
  proximaActualizacionMeses: number;
  propuesta: Propuesta;
  /** Explicación línea por línea, para el expediente y para la IVE. */
  detalle: string[];
}
