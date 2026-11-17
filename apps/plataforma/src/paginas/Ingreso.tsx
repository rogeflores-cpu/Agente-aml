import { useState } from 'react';
import { Boton, Campo, Mensaje } from '../componentes/ui';

export function Ingreso({ modoDemo, alIngresar }: { modoDemo: boolean; alIngresar: (correo: string, clave: string) => Promise<void> }) {
  const [correo, setCorreo] = useState(modoDemo ? 'admin@plataforma.example' : '');
  const [clave, setClave] = useState(modoDemo ? 'demo' : '');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form className="w-full max-w-sm space-y-4 rounded-2xl border border-borde bg-white p-8 shadow-sm"
        onSubmit={async (e) => {
          e.preventDefault(); setEnviando(true); setError(null);
          try { await alIngresar(correo, clave); } catch (x) { setError((x as Error).message); } finally { setEnviando(false); }
        }}>
        <div>
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-tinta text-sm font-bold text-white">AML</div>
          <h1 className="text-xl font-semibold">Administración de la plataforma</h1>
          <p className="mt-1 text-sm text-tinta-suave">Alta de organizaciones, usuarios, metodología, WhatsApp y listas del GAFI.</p>
        </div>
        {modoDemo && <Mensaje tipo="aviso">Modo demostración: datos ficticios, sin conexión a la base.</Mensaje>}
        <Campo etiqueta="Correo" tipo="email" valor={correo} setValor={setCorreo} />
        <Campo etiqueta="Contraseña" tipo="password" valor={clave} setValor={setClave} />
        {error && <Mensaje tipo="error">{error}</Mensaje>}
        <Boton type="submit" disabled={enviando || !correo || !clave}>{enviando ? 'Ingresando…' : 'Ingresar'}</Boton>
      </form>
    </div>
  );
}
