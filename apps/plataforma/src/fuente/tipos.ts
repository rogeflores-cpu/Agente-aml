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
export interface AvisoPlataforma { id: string; asunto: string; cuerpo: string; creadoEn: string; atendidoEn: string | null }

/** Todo lo que la aplicación necesita. Dos implementaciones: API real y demostración. */
export interface Fuente {
  modoDemo: boolean;
  sesion(): Promise<{ correo: string } | null>;
  iniciarSesion(correo: string, clave: string): Promise<void>;
  cerrarSesion(): Promise<void>;
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
  avisos(): Promise<AvisoPlataforma[]>;
  atenderAviso(id: string): Promise<void>;
}
