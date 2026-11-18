import { createHash, randomBytes, randomInt } from 'node:crypto';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Token del enlace seguro: se envía al cliente y en la base solo queda su hash.
 * Dirección: https://<dominio>/<subdominio de la organización>/e/<token>. Una
 * sola dirección para todas las organizaciones (sin subdominios comodín en el
 * DNS); la marca la entrega la API según el token, no la dirección.
 */
export function nuevoEnlace(subdominio: string, dominio: string, vigenciaDias: number, ahora = new Date()) {
  const token = randomBytes(32).toString('base64url');
  return {
    url: `https://${dominio}/${subdominio}/e/${token}`,
    tokenHash: sha256(token),
    expiraEn: new Date(ahora.getTime() + vigenciaDias * 86_400_000).toISOString(),
  };
}

/** Código de 6 dígitos para vincular WhatsApp; vence en 30 minutos. */
export function nuevoCodigoVinculacion(ahora = new Date()) {
  const codigo = randomInt(0, 1_000_000).toString().padStart(6, '0');
  return { codigo, hash: sha256(codigo), expiraEn: new Date(ahora.getTime() + 30 * 60_000).toISOString() };
}
