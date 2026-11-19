import { describe, expect, it } from 'vitest';
import { DEPARTAMENTOS_GUATEMALA, errorRegistral, MUNICIPIOS_POR_DEPARTAMENTO, municipioValido, textoRegistral } from '../src/index.js';

describe('catálogo de departamentos y municipios de Guatemala', () => {
  it('tiene 22 departamentos y 340 municipios, sin repetidos dentro de un departamento', () => {
    expect(DEPARTAMENTOS_GUATEMALA).toHaveLength(22);
    const total = Object.values(MUNICIPIOS_POR_DEPARTAMENTO).reduce((s, m) => s + m.length, 0);
    expect(total).toBe(340);
    for (const [d, m] of Object.entries(MUNICIPIOS_POR_DEPARTAMENTO)) expect(new Set(m).size, d).toBe(m.length);
    const conteo = Object.fromEntries(Object.entries(MUNICIPIOS_POR_DEPARTAMENTO).map(([d, m]) => [d, m.length]));
    expect(conteo).toEqual({
      'Alta Verapaz': 17, 'Baja Verapaz': 8, Chimaltenango: 16, Chiquimula: 11, 'El Progreso': 8, Escuintla: 14, Guatemala: 17,
      Huehuetenango: 33, Izabal: 5, Jalapa: 7, Jutiapa: 17, 'Petén': 14, Quetzaltenango: 24, 'Quiché': 21, Retalhuleu: 9,
      'Sacatepéquez': 16, 'San Marcos': 30, 'Santa Rosa': 14, 'Sololá': 19, 'Suchitepéquez': 21, 'Totonicapán': 8, Zacapa: 11,
    });
  });
  it('valida el municipio contra su departamento', () => {
    expect(municipioValido('Guatemala', 'Mixco')).toBe(true);
    expect(municipioValido('Escuintla', 'San José')).toBe(true);
    expect(municipioValido('Guatemala', 'Antigua Guatemala')).toBe(false);
    expect(municipioValido('Narnia', 'Mixco')).toBe(false);
  });
  it('datos registrales: finca, folio y libro por separado y los tres juntos', () => {
    expect(errorRegistral({})).toBeNull();
    expect(errorRegistral({ finca: '18,452', folio: '210', libro: '98e' })).toBeNull();
    expect(errorRegistral({ finca: '18452' })).toMatchObject({ campo: 'folio' });
    expect(errorRegistral({ finca: 'abc', folio: '1', libro: '1' })).toMatchObject({ campo: 'finca' });
    expect(errorRegistral({ finca: '1', folio: '2', libro: 'libro 9!' })).toMatchObject({ campo: 'libro' });
    expect(textoRegistral({ finca: '18452', folio: '210', libro: '98E' })).toBe('Finca 18452, folio 210, libro 98E');
  });
});
