import { describe, expect, it } from 'vitest';
import { leerEnlace, problemaClave } from '../src/fuente/enlace';

describe('enlaces de invitación y recuperación', () => {
  it('reconoce la invitación, la recuperación y el enlace vencido', () => {
    expect(leerEnlace('#access_token=x&refresh_token=y&type=invite')).toEqual({ tipo: 'clave', motivo: 'invitacion' });
    expect(leerEnlace('#access_token=x&type=recovery')).toEqual({ tipo: 'clave', motivo: 'recuperacion' });
    expect(leerEnlace('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')).toMatchObject({ tipo: 'error' });
    expect(leerEnlace('')).toBeNull();
    expect(leerEnlace('#type=invite')).toBeNull(); // sin token no hay sesión que completar
    expect(leerEnlace('#access_token=x&type=magiclink')).toBeNull();
  });

  it('exige una contraseña razonable y confirmada', () => {
    expect(problemaClave('corta1', 'corta1')).toMatch(/10/);
    expect(problemaClave('solamenteletras', 'solamenteletras')).toMatch(/letras y números/);
    expect(problemaClave('1234567890123', '1234567890123')).toMatch(/letras y números/);
    expect(problemaClave('Guatemala2026', 'Guatemala2025')).toMatch(/no coinciden/);
    expect(problemaClave('Guatemala2026', 'Guatemala2026')).toBeNull();
  });
});
