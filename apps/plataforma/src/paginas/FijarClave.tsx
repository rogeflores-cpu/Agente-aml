import { useState } from 'react';
import { Boton, Mensaje } from '../componentes/ui';
import { problemaClave } from '../fuente/enlace';

/** Primera contraseña (invitación) o contraseña nueva (recuperación). */
export function FijarClave({ correo, motivo, alGuardar }: {
  correo: string; motivo: 'invitacion' | 'recuperacion'; alGuardar: (clave: string) => Promise<void>;
}) {
  const [clave, setClave] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campo = 'w-full rounded-lg border border-borde px-3 py-2 outline-none focus:border-marca';
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form className="w-full max-w-sm space-y-4 rounded-2xl border border-borde bg-white p-8 shadow-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          const p = problemaClave(clave, confirmacion);
          if (p) { setError(p); return; }
          setEnviando(true); setError(null);
          try { await alGuardar(clave); } catch (x) { setError((x as Error).message); } finally { setEnviando(false); }
        }}>
        <div>
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-marca text-sm font-bold text-white">AML</div>
          <h1 className="text-xl font-semibold">{motivo === 'invitacion' ? 'Bienvenido: cree su contraseña' : 'Cree una contraseña nueva'}</h1>
          <p className="mt-1 text-sm text-tinta-suave">Cuenta: <span className="font-medium text-tinta">{correo}</span></p>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Contraseña</span>
          <input type="password" autoComplete="new-password" required value={clave} onChange={(e) => setClave(e.target.value)} className={campo} />
          <span className="mt-1 block text-xs text-tinta-suave">Al menos 10 caracteres, con letras y números.</span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Repita la contraseña</span>
          <input type="password" autoComplete="new-password" required value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} className={campo} />
        </label>
        {error && <Mensaje tipo="error">{error}</Mensaje>}
        <Boton type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar y entrar'}</Boton>
      </form>
    </div>
  );
}
