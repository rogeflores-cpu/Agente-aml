/**
 * Enlaces de Supabase Auth que llegan por correo (invitación o recuperación de
 * contraseña). Supabase redirige con los datos en el fragmento (#...): se leen
 * antes de crear el cliente, que los consume y limpia.
 */
export type EnlaceAuth = { tipo: 'clave'; motivo: 'invitacion' | 'recuperacion' } | { tipo: 'error'; mensaje: string } | null;

export function leerEnlace(fragmento: string): EnlaceAuth {
  const p = new URLSearchParams(fragmento.replace(/^#/, ''));
  if (p.get('error') || p.get('error_code')) {
    return { tipo: 'error', mensaje: 'El enlace venció o ya se usó. Pida uno nuevo con «¿Olvidó su contraseña?».' };
  }
  if (!p.get('access_token')) return null;
  const t = p.get('type');
  if (t === 'invite' || t === 'signup') return { tipo: 'clave', motivo: 'invitacion' };
  if (t === 'recovery') return { tipo: 'clave', motivo: 'recuperacion' };
  return null;
}

/** Reglas mínimas de la contraseña. Devuelve el problema o null. */
export function problemaClave(clave: string, confirmacion: string): string | null {
  if (clave.length < 10) return 'Use al menos 10 caracteres.';
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(clave) || !/\d/.test(clave)) return 'Combine letras y números.';
  if (clave !== confirmacion) return 'Las dos contraseñas no coinciden.';
  return null;
}
