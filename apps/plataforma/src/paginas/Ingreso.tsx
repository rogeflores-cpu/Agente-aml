import { useState } from 'react';
import { Boton, Campo, Mensaje } from '../componentes/ui';

export function Ingreso({ modoDemo, alIngresar, alRecuperar, avisoInicial }: {
  modoDemo: boolean; alIngresar: (correo: string, clave: string) => Promise<void>;
  alRecuperar: (correo: string) => Promise<void>; avisoInicial?: string | null;
}) {
  const [correo, setCorreo] = useState(modoDemo ? 'admin@plataforma.example' : '');
  const [clave, setClave] = useState(modoDemo ? 'demo' : '');
  const [error, setError] = useState<string | null>(avisoInicial ?? null);
  const [recuperando, setRecuperando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  if (recuperando) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-borde bg-white p-8 shadow-sm">
          <Recuperar correoInicial={correo} alRecuperar={alRecuperar} alVolver={() => { setRecuperando(false); setError(null); }} />
        </div>
      </div>
    );
  }

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
        {!modoDemo && (
          <button type="button" className="block text-sm text-marca hover:underline" onClick={() => { setRecuperando(true); setError(null); }}>
            ¿Olvidó su contraseña o es su primer ingreso?
          </button>
        )}
      </form>
    </div>
  );
}

function Recuperar({ correoInicial, alRecuperar, alVolver }: { correoInicial: string; alRecuperar: (correo: string) => Promise<void>; alVolver: () => void }) {
  const [correo, setCorreo] = useState(correoInicial);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setEnviando(true); setError(null);
      try { await alRecuperar(correo); setEnviado(true); } catch (x) { setError((x as Error).message); } finally { setEnviando(false); }
    }}>
      <h2 className="text-base font-semibold">Crear una contraseña nueva</h2>
      {enviado ? (
        <Mensaje tipo="ok">Si el correo está registrado, recibirá un enlace en unos minutos. Revise también la carpeta de correo no deseado.</Mensaje>
      ) : (
        <>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Correo</span>
            <input type="email" required value={correo} onChange={(e) => setCorreo(e.target.value)}
              className="w-full rounded-lg border border-borde px-3 py-2 outline-none focus:border-marca" />
          </label>
          {error && <Mensaje tipo="error">{error}</Mensaje>}
          <Boton type="submit" disabled={enviando || !correo}>{enviando ? 'Enviando…' : 'Enviar enlace'}</Boton>
        </>
      )}
      <button type="button" className="block text-sm text-marca hover:underline" onClick={alVolver}>← Volver a ingresar</button>
    </form>
  );
}
