/** Lo que el portal recibe del servidor. Todo es del lado del cliente (art. 38). */
export interface Marca {
  nombreVisible: string;
  colorPrimario: string;
  logoUrl: string | null;
}

export interface VistaPortal {
  nombreOrganizacion: string;
  nombreCliente: string;
  parte: 'comprador' | 'vendedor' | string;
  estado: string;
  datos: { campo: string; valor: unknown; origen: string; confirmado: boolean }[];
  documentos: { clave: string; estado: string }[];
  pendientes: { tipo: string; descripcion: string }[];
}

export interface MensajeConversacion {
  rol: 'cliente' | 'agente';
  texto: string;
}

export interface EstadoPortal {
  marca: Marca;
  vista: VistaPortal;
  conversacion: MensajeConversacion[];
}

export interface CodigoWhatsapp {
  codigo: string;
  numero: string;
  expiraEn: string;
  enlaceWhatsapp: string;
}

/** Error con el código HTTP, para distinguir enlace inválido (401) o vencido (410). */
export class ErrorPortal extends Error {
  constructor(mensaje: string, public estado: number) {
    super(mensaje);
  }
}

export interface FuentePortal {
  modoDemo: boolean;
  cargar(): Promise<EstadoPortal>;
  enviarMensaje(texto: string): Promise<string>;
  subirDocumento(archivo: File, nota?: string): Promise<string>;
  codigoWhatsapp(): Promise<CodigoWhatsapp>;
  enviarARevision(): Promise<{ enviado: boolean; pendientes: string[] }>;
}

export const MAX_BYTES = 10 * 1024 * 1024;
export const TIPOS_ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Validación previa en el navegador; el servidor vuelve a validar por contenido. */
export function validarArchivo(f: { size: number; type: string }): string | null {
  if (f.size === 0) return 'El archivo está vacío.';
  if (f.size > MAX_BYTES) return 'El archivo supera 10 MB. Envíe una foto o un PDF más liviano.';
  if (f.type && !TIPOS_ACEPTADOS.includes(f.type)) return 'Formato no admitido. Envíe una foto (JPG, PNG o WEBP) o un PDF.';
  return null;
}
