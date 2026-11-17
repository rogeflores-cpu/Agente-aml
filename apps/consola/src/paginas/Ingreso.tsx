import { useState } from 'react';
import { Boton, Mensaje } from '../componentes/ui';
import type { Rol } from '../fuente/tipos';

export function Ingreso({ modoDemo, alIngresar }: { modoDemo: boolean; alIngresar: (correo: string, clave: string, rol?: Rol) => Promise<void> }) {
  const [correo, setCorreo] = useState(modoDemo ? 'oficial@demo.example' : '');
  const [clave, setClave] = useState(modoDemo ? 'demo' : '');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [rol, setRol] = useState<Rol>('oficial');

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        className="w-full max-w-sm rounded-2xl border border-borde bg-white p-8 shadow-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          setEnviando(true);
          setError(null);
          try { await alIngresar(correo, clave, modoDemo ? rol : undefined); } catch (err) { setError((err as Error).message); } finally { setEnviando(false); }
        }}
      >
        <div className="mb-6">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-marca text-sm font-bold text-white">AML</div>
          <h1 className="text-xl font-semibold">Agente AML</h1>
          <p className="mt-1 text-sm text-tinta-suave">Acceso para el equipo de la inmobiliaria y de cumplimiento.</p>
        </div>
        {modoDemo && <div className="mb-4"><Mensaje tipo="aviso">Modo demostración: datos ficticios, sin conexión a la base.</Mensaje></div>}
        {modoDemo && (
          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium">Entrar como</span>
            <select value={rol} onChange={(e) => { const r = e.target.value as Rol; setRol(r); setCorreo(`${r}@demo.example`); }}
              className="w-full rounded-lg border border-borde px-3 py-2 outline-none focus:border-marca">
              <option value="oficial">Oficial de cumplimiento</option>
              <option value="ejecutivo">Ejecutivo de la inmobiliaria</option>
              <option value="administrador">Administrador de la inmobiliaria</option>
            </select>
          </label>
        )}
        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium">Correo</span>
          <input type="email" required value={correo} onChange={(e) => setCorreo(e.target.value)}
            className="w-full rounded-lg border border-borde px-3 py-2 outline-none focus:border-marca" />
        </label>
        <label className="mb-5 block text-sm">
          <span className="mb-1 block font-medium">Contraseña</span>
          <input type="password" required value={clave} onChange={(e) => setClave(e.target.value)}
            className="w-full rounded-lg border border-borde px-3 py-2 outline-none focus:border-marca" />
        </label>
        {error && <div className="mb-4"><Mensaje tipo="error">{error}</Mensaje></div>}
        <Boton type="submit" disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar'}</Boton>
      </form>
    </div>
  );
}
