import type { ResultadoEvaluacion } from '@agente-aml/riesgo';

export type Rol = 'administrador' | 'ejecutivo' | 'oficial' | 'oficial_suplente' | 'auditor';
export type EstadoExpediente =
  | 'invitado' | 'en_captura' | 'en_revision' | 'listo_para_decision' | 'aprobado'
  | 'aprobado_condicionado' | 'rechazado' | 'abstenido' | 'en_examen';
export type Nivel = 'bajo' | 'medio' | 'alto';

export interface Sesion { usuarioId: string; correo: string }
export interface Organizacion { id: string; nombre: string; rol: Rol }

export interface FilaBandeja {
  id: string;
  codigoOperacion: string;
  parte: 'comprador' | 'vendedor';
  tipoPersona: 'individual' | 'juridica' | 'estructura';
  nombre: string;
  estado: EstadoExpediente;
  nivel: Nivel | null;
  pendientes: number;
  coincidenciasSinDisponer: number;
  alertasAbiertas: number;
  actualizadoEn: string;
}

export interface Dato {
  campo: string;
  valor: unknown;
  origen: 'cliente' | 'documento' | 'fuente_externa' | 'revisor';
  documentoId: string | null;
  pagina: number | null;
  confianza: number | null;
  confirmado: boolean;
}

export interface DocumentoExp { id: string; tipo: string; estado: string; canal: string; sha256: string; creadoEn: string }
export interface Pendiente { id: string; tipo: string; descripcion: string; estado: string }
export interface Coincidencia { referencia: string; lista: string; nombreListado: string; nombreCoincidente: string; puntaje: number; fechaNacimiento: string; prioridad: string }
export interface Verificacion {
  id: string; nombreConsultado: string; fuente: string; versionFuente: string | null; consultadoEn: string;
  resultado: 'sin_coincidencia' | 'posible_coincidencia' | 'coincidencia_confirmada' | 'descartada';
  coincidencias: Coincidencia[]; justificacion: string | null; dispuestoEn: string | null;
}
export interface Alerta { id: string; senal: string; descripcion: string; estado: string; venceEn: string | null; creadoEn: string; cierre: string | null }
export interface Evaluacion {
  id: string; calculadoEn: string; puntajes: Record<string, number>; puntajeTotal: number;
  nivelCalculado: Nivel; nivelAjustado: Nivel | null; justificacionAjuste: string | null; medidas: string;
  reglas: ResultadoEvaluacion['reglas']; senales: ResultadoEvaluacion['senales'];
}
export interface Decision { id: string; tipo: string; justificacion: string; condiciones: string | null; decididoEn: string; decididoPor: string }
export interface EventoBitacora { id: number; ocurridoEn: string; actorTipo: string; evento: string; entidad: string; hash: string }

export interface DetalleExpediente {
  id: string;
  organizacionId: string;
  codigoOperacion: string;
  parte: 'comprador' | 'vendedor';
  tipoPersona: 'individual' | 'juridica' | 'estructura';
  estado: EstadoExpediente;
  contacto: { nombre: string; telefono: string | null; correo: string | null; whatsappVinculado: boolean };
  operacion: { tipo: string; precio: number | null; moneda: string; inmueble: Record<string, string>; formaPago: { medio: string; monto: number; moneda?: string }[] };
  verificacionDiferidaHasta: string | null;
  datos: Dato[];
  documentos: DocumentoExp[];
  pendientes: Pendiente[];
  verificaciones: Verificacion[];
  alertas: Alerta[];
  evaluaciones: Evaluacion[];
  decisiones: Decision[];
  bitacora: EventoBitacora[];
}

export interface Aviso { id: string; asunto: string; cuerpo: string; prioridad: 'normal' | 'alta' | 'urgente'; expedienteId: string | null; creadaEn: string; leida: boolean }

export interface AjustesEvaluacion {
  presencial?: boolean;
  intermediario?: boolean;
  actuaPorRepresentacion?: boolean;
  contratistaOProveedorEstado?: boolean;
  noDomiciliado?: boolean;
  coherenciaPerfilMonto?: 'coherente' | 'dudosa' | 'incoherente';
  transaccionInusual?: boolean;
  tipoCambioUsd?: number;
}

export interface NuevaDecision {
  tipo: 'aprobar' | 'aprobar_diferida' | 'intensificar' | 'rechazar' | 'abstener' | 'abrir_examen';
  justificacion: string;
  condiciones?: string;
  verificacionDiferidaHasta?: string;
  /** Obligatorio cuando decide el oficial suplente: por qué actúa en lugar del titular. */
  motivoSuplencia?: string;
}

// ---------------------------------------------------------------- vista operativa
/**
 * Estado que ven administrador y ejecutivo (art. 38): el examen y la revisión
 * interna se muestran igual que una revisión normal.
 */
export type EstadoComercial = 'invitado' | 'en_captura' | 'en_revision' | 'aprobado' | 'no_aprobado';

/** Parte de una operación tal como la ve el área comercial. Sin datos de cumplimiento. */
export interface ParteOperativa {
  expedienteId: string;
  parte: 'comprador' | 'vendedor';
  tipoPersona: 'individual' | 'juridica' | 'estructura';
  nombre: string;
  telefono: string | null;
  correo: string | null;
  estado: EstadoComercial;
  pendientes: number;
  whatsappVinculado: boolean;
  actualizadoEn: string;
}

export interface FilaOperacion {
  id: string;
  codigo: string;
  tipo: 'compraventa' | 'intermediacion';
  precio: number | null;
  moneda: string;
  inmueble: Record<string, string>;
  creadaEn: string;
  partes: ParteOperativa[];
}

export type MedioPago = 'efectivo' | 'transferencia_local' | 'transferencia_exterior' | 'cheque' | 'financiamiento_bancario' | 'activos_virtuales' | 'otro';

export interface NuevaOperacion {
  tipo: 'compraventa' | 'intermediacion';
  inmueble: { departamento: string; municipio?: string; finca?: string; direccion?: string };
  precio?: number;
  moneda: string;
  valorReferencia?: number;
  formaPago: { medio: MedioPago; monto: number; pagador: 'cliente' | 'tercero' }[];
  partes: { parte: 'comprador' | 'vendedor'; tipoPersona: 'individual' | 'juridica' | 'estructura'; nombre: string; telefono?: string; correo?: string }[];
}

export interface NuevoPagoEfectivo { expedienteId: string; fecha: string; monto: number; moneda: string; tipoCambioUsd: number }

export interface ResultadoReenvio { canal: 'whatsapp' | 'manual'; url?: string; expiraEn: string }

export const ROLES_CUMPLIMIENTO: Rol[] = ['oficial', 'oficial_suplente', 'auditor'];
export const ROLES_OPERATIVOS: Rol[] = ['administrador', 'ejecutivo'];

/** Todo lo que la consola necesita. Dos implementaciones: Supabase y demostración. */
export interface Fuente {
  modoDemo: boolean;
  sesion(): Promise<Sesion | null>;
  /** rolDemo solo se usa en modo demostración para elegir con qué rol entrar. */
  iniciarSesion(correo: string, clave: string, rolDemo?: Rol): Promise<void>;
  cerrarSesion(): Promise<void>;
  organizaciones(): Promise<Organizacion[]>;
  bandeja(organizacionId: string): Promise<FilaBandeja[]>;
  expediente(id: string): Promise<DetalleExpediente>;
  avisos(organizacionId: string): Promise<Aviso[]>;
  marcarLeido(avisoId: string): Promise<void>;
  evaluar(expedienteId: string, ajustes: AjustesEvaluacion): Promise<{ advertencias: string[] }>;
  disponer(verificacionId: string, resultado: 'descartada' | 'coincidencia_confirmada', justificacion: string): Promise<void>;
  decidir(expedienteId: string, d: NuevaDecision): Promise<void>;
  cerrarAlerta(alertaId: string, cierre: string): Promise<void>;
  urlDocumento(documentoId: string): Promise<string | null>;

  // Vista operativa (administrador y ejecutivo)
  operaciones(organizacionId: string): Promise<FilaOperacion[]>;
  registrarOperacion(organizacionId: string, op: NuevaOperacion): Promise<{ codigo: string }>;
  reenviarEnlace(expedienteId: string): Promise<ResultadoReenvio>;
  registrarPagoEfectivo(p: NuevoPagoEfectivo): Promise<void>;
}
