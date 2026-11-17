import { ErrorPortal, type FuentePortal } from './tipos';

const CLAVE = 'aml-enlace';

/**
 * Lee el token del enlace (/e/<token>), lo guarda en la pestaña y lo quita de
 * la barra de direcciones para que no quede a la vista ni en el historial.
 */
export function tokenDelEnlace(): string | null {
  const m = window.location.pathname.match(/^\/e\/([A-Za-z0-9_-]{43})\/?$/);
  if (m) {
    try { sessionStorage.setItem(CLAVE, m[1]); } catch { /* sin almacenamiento: se usa solo en memoria */ }
    window.history.replaceState(null, '', '/e/');
    return m[1];
  }
  try { return sessionStorage.getItem(CLAVE); } catch { return null; }
}

export function fuenteApi(token: string): FuentePortal {
  const base = `${(import.meta.env.VITE_API_URL as string) ?? ''}/api/portal`;
  const llamar = async (ruta: string, init: RequestInit = {}) => {
    const r = await fetch(`${base}${ruta}`, {
      ...init,
      headers: { Authorization: `Enlace ${token}`, ...(init.headers ?? {}) },
      referrerPolicy: 'no-referrer',
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new ErrorPortal(json.error ?? 'No pudimos procesar su solicitud.', r.status);
    return json;
  };
  const json = (cuerpo: unknown): RequestInit => ({
    method: 'POST', body: JSON.stringify(cuerpo), headers: { 'Content-Type': 'application/json' },
  });

  return {
    modoDemo: false,
    cargar: () => llamar('/vista'),
    enviarMensaje: async (texto) => (await llamar('/mensaje', json({ texto }))).respuesta,
    async subirDocumento(archivo, nota) {
      const fd = new FormData();
      fd.append('archivo', archivo);
      if (nota) fd.append('nota', nota);
      return (await llamar('/documento', { method: 'POST', body: fd })).respuesta;
    },
    codigoWhatsapp: () => llamar('/codigo-whatsapp', { method: 'POST' }),
    enviarARevision: () => llamar('/enviar-a-revision', { method: 'POST' }),
  };
}
