import { describe, expect, it } from 'vitest';
import { prellenar } from '../src/index.js';

describe('prellenado desde documentos', () => {
  const dpi = {
    nombre_completo: { valor: 'ANA LUCIA PEREZ GOMEZ' },
    cui: { valor: '2345678900101' },
    fecha_nacimiento: { valor: '1985-04-12' },
    lugar_nacimiento: { valor: null },
  };

  it('propone los datos del DPI y el tipo de documento', () => {
    const p = prellenar('dpi', dpi, new Set());
    expect(p.map((x) => x.campo).sort()).toEqual([
      'cliente.documento_numero', 'cliente.documento_tipo', 'cliente.fecha_nacimiento', 'cliente.nombre_completo',
    ]);
    expect(p.find((x) => x.campo === 'cliente.documento_tipo')?.valor).toBe('DPI');
  });

  it('no sobrescribe lo que el cliente ya declaró', () => {
    const p = prellenar('dpi', dpi, new Set(['cliente.nombre_completo', 'cliente.documento_tipo']));
    expect(p.map((x) => x.campo)).not.toContain('cliente.nombre_completo');
    expect(p.map((x) => x.campo)).not.toContain('cliente.documento_tipo');
  });

  it('documentos sin mapa no proponen nada', () => {
    expect(prellenar('soporte_origen_fondos', { monto: { valor: 1000 } }, new Set())).toEqual([]);
  });
});
