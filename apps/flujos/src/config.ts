/** Variables de entorno requeridas. Ver variables-entorno.ejemplo en la raíz del repositorio. */
function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

export const config = {
  get supabaseUrl() { return requerida('SUPABASE_URL'); },
  get supabaseServiceKey() { return requerida('SUPABASE_SERVICE_ROLE_KEY'); },
  /** Llave pública: la API de la consola actúa con el token del usuario para que apliquen sus permisos. */
  get supabaseAnonKey() { return requerida('SUPABASE_ANON_KEY'); },
  /** Origen permitido para la consola (CORS), p. ej. https://consola.<dominio>. */
  consolaOrigen: process.env.CONSOLA_ORIGEN ?? 'http://localhost:5173',
  /** Correos de los administradores de la plataforma (carga de listas GAFI). */
  adminsPlataforma: (process.env.PLATAFORMA_ADMINS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
  /** Secreto de la app de Meta: valida la firma de cada webhook. */
  get metaAppSecret() { return requerida('META_APP_SECRET'); },
  /** Token que se configura en Meta para verificar el webhook. */
  get metaVerifyToken() { return requerida('META_VERIFY_TOKEN'); },
  /** Versión de la Graph API de Meta, p. ej. v21.0 (usar la vigente). */
  get graphApiVersion() { return requerida('META_GRAPH_API_VERSION'); },
  /** Dominio del portal: https://<dominio>/<subdominio de la organización>/e/<token> */
  get dominioPortal() { return requerida('PORTAL_DOMINIO'); },
  /** URL del XML de la lista consolidada del Consejo de Seguridad de la ONU. */
  get onuListaUrl() { return requerida('ONU_LISTA_URL'); },
  /** URL del XML de la lista SDN de la OFAC (EE. UU.). Tiene valor por defecto. */
  get ofacListaUrl() {
    return process.env.OFAC_LISTA_URL || 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML';
  },
  /**
   * Opcional: URL a la que se envía cada día el ancla de la bitácora (último
   * eslabón por organización) para conservarla fuera de la base, p. ej. un
   * almacenamiento con retención inmutable o un servicio de sellado de tiempo.
   */
  anclaBitacoraUrl: process.env.ANCLA_BITACORA_URL ?? '',
  enlaceVigenciaDias: Number(process.env.ENLACE_VIGENCIA_DIAS ?? 7),
  recordatorios: { cantidad: 3, intervalo: '2d' as const },
};
