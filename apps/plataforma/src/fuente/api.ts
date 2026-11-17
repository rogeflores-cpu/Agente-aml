import { createClient } from '@supabase/supabase-js';
import type { DetalleOrganizacion, EstadoAlta, Fuente } from './tipos';

/** Fuente real: sesión con Supabase y datos por la API de la plataforma (llave de servicio en el servidor). */
export function fuenteApi(): Fuente {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const api = (import.meta.env.VITE_API_URL as string) ?? '';
  if (!url || !anon) throw new Error('Configure VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY');
  const sb = createClient(url, anon);

  const llamar = async (ruta: string, cuerpo?: unknown, metodo = cuerpo === undefined ? 'GET' : 'POST') => {
    const { data } = await sb.auth.getSession();
    const r = await fetch(`${api}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error([json.error, ...(json.detalle ?? [])].filter(Boolean).join(' · ') || `Error ${r.status}`);
    return json;
  };

  const estado = (f: any): EstadoAlta => ({
    id: f.id, nombreLegal: f.nombre_legal, nombreComercial: f.nombre_comercial, nit: f.nit, actividad: f.actividad,
    subdominio: f.subdominio, inscripcionIve: f.inscripcion_ive, creadoEn: f.creado_en,
    marca: { nombreVisible: f.marca?.nombre_visible ?? f.nombre_comercial, colorPrimario: f.marca?.color_primario ?? '#0f5e5a', logoUrl: f.marca?.logo_url ?? null },
    metodologiaVersionAprobada: f.metodologia_version_aprobada, metodologiaPendiente: f.metodologia_pendiente,
    oficiales: Number(f.oficiales), suplentes: Number(f.suplentes), usuarios: Number(f.usuarios),
    whatsappEstado: f.whatsapp_estado, whatsappNumero: f.whatsapp_numero, listaParaOperar: f.lista_para_operar,
  });

  return {
    modoDemo: false,
    async sesion() {
      const { data } = await sb.auth.getSession();
      return data.session ? { correo: data.session.user.email ?? '' } : null;
    },
    async iniciarSesion(correo, clave) {
      const { error } = await sb.auth.signInWithPassword({ email: correo, password: clave });
      if (error) throw new Error('Correo o contraseña incorrectos');
    },
    async cerrarSesion() { await sb.auth.signOut(); },

    async organizaciones() {
      return ((await llamar('/api/plataforma/organizaciones')).organizaciones as any[]).map(estado);
    },
    async organizacion(id): Promise<DetalleOrganizacion> {
      const j = await llamar(`/api/plataforma/organizaciones/${id}`);
      return {
        estado: estado(j.estado),
        usuarios: j.usuarios.map((u: any) => ({ usuarioId: u.usuario_id, correo: u.correo, rol: u.rol, activo: u.activo, invitacionPendiente: u.invitacionPendiente })),
        configuraciones: j.configuraciones.map((c: any) => ({ id: c.id, version: c.version, aprobadaPor: c.aprobada_por, aprobadaEn: c.aprobada_en, vigenteDesde: c.vigente_desde, creadoEn: c.creado_en })),
        canal: j.canal ? { wabaId: j.canal.waba_id, phoneNumberId: j.canal.phone_number_id, numeroVisible: j.canal.numero_visible, nombreVisible: j.canal.nombre_visible, estado: j.canal.estado, tokenGuardado: j.canal.tokenGuardado } : null,
      };
    },
    async crearOrganizacion(d) { return llamar('/api/plataforma/organizaciones', d); },
    async actualizarOrganizacion(id, d) { await llamar(`/api/plataforma/organizaciones/${id}`, d, 'PATCH'); },
    async invitarUsuario(id, correo, rol) { return llamar(`/api/plataforma/organizaciones/${id}/usuarios`, { correo, rol }); },
    async desactivarUsuario(id, usuarioId) { await llamar(`/api/plataforma/organizaciones/${id}/usuarios/${usuarioId}/desactivar`, {}); },
    async aprobarMetodologia(id, d) { await llamar(`/api/plataforma/organizaciones/${id}/metodologia/aprobar`, d); },
    async conectarWhatsapp(id, d) {
      const r = await llamar(`/api/plataforma/organizaciones/${id}/whatsapp`, d);
      return { estado: r.estado, error: r.verificacion?.ok ? undefined : r.verificacion?.error };
    },
    async listasGafi() {
      return ((await llamar('/api/plataforma/listas-gafi')).listas as any[]).map((l) => ({
        id: l.id, plenario: l.plenario, altoRiesgo: l.alto_riesgo, monitoreo: l.monitoreo,
        fuenteAltoRiesgo: l.fuente_alto_riesgo, fuenteMonitoreo: l.fuente_monitoreo, cargadaPor: l.cargada_por, cargadaEn: l.cargada_en,
      }));
    },
    // La carga de listas GAFI vive en la API de la consola; se reutiliza.
    async cargarListaGafi(d) { await llamar('/api/consola/plataforma/listas-gafi', d); },
    async avisos() {
      return ((await llamar('/api/plataforma/avisos')).avisos as any[]).map((a) => ({ id: a.id, asunto: a.asunto, cuerpo: a.cuerpo, creadoEn: a.creado_en, atendidoEn: a.atendido_en }));
    },
    async atenderAviso(id) { await llamar(`/api/plataforma/avisos/${id}/atender`, {}); },
  };
}
