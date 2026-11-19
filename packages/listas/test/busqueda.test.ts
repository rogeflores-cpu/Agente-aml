import { describe, expect, it } from 'vitest';
import { buscarEnListas, type RegistroLista } from '../src/index.js';

const reg = (p: Partial<RegistroLista>): RegistroLista => ({
  referencia: 'QDi.001', lista: 'Al-Qaida', tipo: 'individual', nombre: 'X', alias: [], fechasNacimiento: [], nacionalidades: [], documentos: [], ...p,
});
const onu = [
  reg({ referencia: 'QDi.123', nombre: 'Juan Carlos Méndez Orellana', alias: ['El Contador'], documentos: ['A1234567'] }),
  reg({ referencia: 'QDi.124', nombre: 'Pedro Álvarez Ruiz' }),
  reg({ referencia: 'QDe.010', tipo: 'entidad', nombre: 'Fundación Ejemplo Internacional, S.A.' }),
];
const fuentes = [{ fuente: 'onu' as const, registros: onu }];

describe('búsqueda libre en las listas', () => {
  it('encuentra por nombre completo, sin tildes ni orden', () => {
    const r = buscarEnListas('mendez orellana juan carlos', fuentes);
    expect(r[0].registro.referencia).toBe('QDi.123');
    expect(r[0].puntaje).toBeGreaterThanOrEqual(0.9);
  });
  it('encuentra por un apellido, por alias y por parte del nombre de la entidad', () => {
    expect(buscarEnListas('Orellana', fuentes).map((x) => x.registro.referencia)).toEqual(['QDi.123']);
    expect(buscarEnListas('el contador', fuentes)[0].nombreCoincidente).toBe('El Contador');
    expect(buscarEnListas('fundacion ejemplo', fuentes)[0].registro.referencia).toBe('QDe.010');
  });
  it('encuentra por referencia y por documento', () => {
    expect(buscarEnListas('qdi 124', fuentes)[0]).toMatchObject({ motivo: 'referencia', registro: { referencia: 'QDi.124' } });
    expect(buscarEnListas('a-1234567', fuentes)[0]).toMatchObject({ motivo: 'documento' });
  });
  it('filtra por tipo, ignora búsquedas muy cortas y no inventa resultados', () => {
    expect(buscarEnListas('fundacion ejemplo', fuentes, { tipo: 'individual' })).toEqual([]);
    expect(buscarEnListas('ab', fuentes)).toEqual([]);
    expect(buscarEnListas('María Fernanda López', fuentes)).toEqual([]);
  });
});
