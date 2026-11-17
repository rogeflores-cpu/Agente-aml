import { useState } from 'react';
import type { CodigoWhatsapp } from '../fuente/tipos';

export function Whatsapp({ obtener }: { obtener: () => Promise<CodigoWhatsapp> }) {
  const [codigo, setCodigo] = useState<CodigoWhatsapp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  if (!codigo) {
    return (
      <div className="rounded-2xl border border-borde bg-white p-4">
        <p className="text-[15px] font-medium">¿Prefiere continuar por WhatsApp?</p>
        <p className="mt-1 text-sm text-tinta-suave">Le daremos un código para vincular su número con este expediente.</p>
        {error && <p className="mt-2 text-sm text-error" role="alert">{error}</p>}
        <button disabled={cargando} onClick={async () => {
          setCargando(true); setError(null);
          try { setCodigo(await obtener()); } catch (e) { setError((e as Error).message); } finally { setCargando(false); }
        }} className="mt-3 rounded-full border border-marca px-4 py-2 text-sm font-medium text-marca disabled:opacity-40">
          {cargando ? 'Generando…' : 'Continuar por WhatsApp'}
        </button>
      </div>
    );
  }
  const hora = new Date(codigo.expiraEn).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="rounded-2xl border border-marca bg-marca-claro p-4">
      <p className="text-sm">Envíe este código por WhatsApp al <strong>{codigo.numero}</strong>:</p>
      <p className="my-3 text-center font-mono text-3xl font-semibold tracking-[0.3em]" aria-label={`Código ${codigo.codigo.split('').join(' ')}`}>{codigo.codigo}</p>
      <a href={codigo.enlaceWhatsapp} target="_blank" rel="noopener noreferrer"
        className="block rounded-full bg-marca py-2.5 text-center text-sm font-medium text-sobre-marca">Abrir WhatsApp</a>
      <p className="mt-2 text-center text-xs text-tinta-suave">El código vence a las {hora}</p>
    </div>
  );
}
