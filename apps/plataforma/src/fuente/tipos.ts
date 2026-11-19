export type Rol = 'administrador' | 'ejecutivo' | 'oficial' | 'oficial_suplente' | 'auditor';

export interface Marca { nombreVisible: string; colorPrimario: string; logoUrl: string | null }

export interface EstadoAlta {
  id: string;
  nombreLegal: string;
  nombreComercial: string;
  nit: string;
  actividad: string;
  subdominio: string;
  inscripcionIve: string | null;
  marca: Marca;
  creadoEn: string;
  metodologiaVersionAprobada: number | null;
  metodologiaPendiente: boolean;
  oficiales: number;
  suplentes: number;
  usuarios: number;
  whatsappEstado: 'pendiente' | 'activo' | 'suspendido' | null;
  whatsappNumero: string | null;
  listaParaOperar: boolean;
}

export interface UsuarioOrganizacion { usuarioId: string; correo: string | null; rol: Rol; activo: boolean; invitacionPendiente: boolean }
export interface VersionMetodologia { id: string; version: number; aprobadaPor: string | null; aprobadaEn: string | null; vigenteDesde: string | null; creadoEn: string }
export interface Canal { wabaId: string; phoneNumberId: string; numeroVisible: string; nombreVisible: string; estado: string; tokenGuardado: boolean }

export interface DetalleOrganizacion {
  estado: EstadoAlta;
  usuarios: UsuarioOrganizacion[];
  configuraciones: VersionMetodologia[];
  canal: Canal | null;
}

export interface NuevaOrganizacion {
  nombreLegal: string;
  nombreComercial: string;
  nit: string;
  actividad: string;
  inscripcionIve?: string;
  subdominio: string;
  marca: { nombreVisible: string; colorPrimario: string; logoUrl?: string };
}

export interface DatosWhatsapp { wabaId: string; phoneNumberId: string; numeroVisible: string; nombreVisible: string; token: string }
export interface Aprobacion { organo: string; fecha: string; acta: string }
export interface ListaGafi { id: string; plenario: string; altoRiesgo: string[]; monitoreo: string[]; fuenteAltoRiesgo: string; fuenteMonitoreo: string; cargadaPor: string; cargadaEn: string }
export interface NuevaListaGafi { plenario: string; altoRiesgo: string[]; monitoreo: string[]; fuenteAltoRiesgo: string; fuenteMonitoreo: string }
/** Designación de la S/RES/1373(2001) (art. 43 c), registrada a mano por la plataforma. */
export interface Designacion1373 {
  id: string; tipo: 'individual' | 'entidad'; nombre: string; alias: string[]; documentos: string[]; fechasNacimiento: string[];
  nacionalidades: string[]; autoridad: string; referencia: string; fuenteUrl: string | null; designadaEl: string;
  cargadaPor: string; cargadaEn: string; revocadaEl: string | null; revocacionReferencia: string | null;
}
export interface NuevaDesignacion1373 {
  tipo: 'individual' | 'entidad'; nombre: string; alias: string[]; documentos: string[]; fechasNacimiento: string[];
  nacionalidades: string[]; autoridad: string; referencia: string; fuenteUrl?: string; designadaEl: string;
}
export interface AvisoPlataforma { id: string; asunto: string; cuerpo: string; creadoEn: string; atendidoEn: string | null }

/** Todo lo que la aplicación necesita. Dos implementaciones: API real y demostración. */
export interface Fuente {
  modoDemo: boolean;
  sesion(): Promise<{ correo: string } | null>;
  iniciarSesion(correo: string, clave: string): Promise<void>;
  cerrarSesion(): Promise<void>;
  buscarListas(q: string, tipo?: 'individual' | 'entidad'): Promise<RespuestaBusquedaListas>;
  /** Enlace de invitación o recuperación con el que se abrió la aplicación. */
  enlace(): import('./enlace').EnlaceAuth;
  fijarClave(clave: string): Promise<void>;
  /** Envía el correo para crear una contraseña nueva (no revela si el correo existe). */
  recuperarClave(correo: string): Promise<void>;
  organizaciones(): Promise<EstadoAlta[]>;
  organizacion(id: string): Promise<DetalleOrganizacion>;
  crearOrganizacion(d: NuevaOrganizacion): Promise<{ id: string; advertencias: string[] }>;
  actualizarOrganizacion(id: string, d: { inscripcionIve?: string }): Promise<void>;
  invitarUsuario(id: string, correo: string, rol: Rol): Promise<{ invitado: boolean }>;
  desactivarUsuario(id: string, usuarioId: string): Promise<void>;
  aprobarMetodologia(id: string, d: Aprobacion): Promise<void>;
  conectarWhatsapp(id: string, d: DatosWhatsapp): Promise<{ estado: string; error?: string }>;
  listasGafi(): Promise<ListaGafi[]>;
  cargarListaGafi(d: NuevaListaGafi): Promise<void>;
  designaciones1373(): Promise<Designacion1373[]>;
  registrarDesignacion1373(d: NuevaDesignacion1373): Promise<void>;
  revocarDesignacion1373(id: string, revocadaEl: string, referencia: string): Promise<void>;
  avisos(): Promise<AvisoPlataforma[]>;
  atenderAviso(id: string): Promise<void>;
}

/** Búsqueda libre en las listas cargadas (ONU y designaciones S/RES/1373). */
export interface ResultadoLista {
  fuente: 'onu' | 'designacion_1373';
  motivo: 'referencia' | 'documento' | 'nombre';
  puntaje: number;
  nombreCoincidente: string;
  referencia: string;
  lista: string;
  tipo: 'individual' | 'entidad';
  nombre: string;
  alias: string[];
  fechasNacimiento: string[];
  nacionalidades: string[];
  documentos: string[];
  incluidoEl?: string;
}
export interface RespuestaBusquedaListas {
  listas: { onuRegistros: number; onuGeneradaEl: string | null; onuCargadaEn: string | null; designaciones1373: number };
  resultados: ResultadoLista[];
}
