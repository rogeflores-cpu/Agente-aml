import type { ReactNode } from 'react';

export function Insignia({ clase, children }: { clase: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${clase}`}>{children}</span>;
}

export function Tarjeta({ titulo, accion, children, className = '' }: { titulo?: ReactNode; accion?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-borde bg-white ${className}`}>
      {titulo && (
        <header className="flex items-center justify-between gap-4 border-b border-borde px-5 py-3">
          <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
          {accion}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Boton({
  children, onClick, tipo = 'primario', disabled, type = 'button',
}: { children: ReactNode; onClick?: () => void; tipo?: 'primario' | 'secundario' | 'peligro'; disabled?: boolean; type?: 'button' | 'submit' }) {
  const estilos = {
    primario: 'bg-marca text-white hover:bg-[#0b4a47]',
    secundario: 'border border-borde bg-white text-tinta hover:bg-papel',
    peligro: 'bg-alto text-white hover:bg-[#912018]',
  }[tipo];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${estilos}`}>
      {children}
    </button>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-tinta-suave">{children}</p>;
}

export function Mensaje({ tipo, children }: { tipo: 'error' | 'aviso' | 'ok'; children: ReactNode }) {
  const c = { error: 'border-alto/30 bg-alto-claro text-alto', aviso: 'border-medio/30 bg-medio-claro text-medio', ok: 'border-bajo/30 bg-bajo-claro text-bajo' }[tipo];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${c}`}>{children}</div>;
}

export const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function Campo({
  etiqueta, valor, setValor, tipo = 'text', placeholder, ayuda, error,
}: {
  etiqueta: string; valor: string; setValor: (v: string) => void; tipo?: string; placeholder?: string; ayuda?: string; error?: string | null;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{etiqueta}</span>
      <input type={tipo} value={valor} placeholder={placeholder} onChange={(e) => setValor(e.target.value)}
        className={`w-full rounded-lg border px-3 py-2 outline-none focus:border-marca ${error ? 'border-alto' : 'border-borde'}`} />
      {error ? <span className="mt-1 block text-xs text-alto">{error}</span> : ayuda && <span className="mt-1 block text-xs text-tinta-suave">{ayuda}</span>}
    </label>
  );
}

export function Paso({ hecho, children }: { hecho: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${hecho ? 'bg-bajo text-white' : 'border border-borde text-tinta-suave'}`}>
        {hecho ? '✓' : ''}
      </span>
      <span className={hecho ? '' : 'text-tinta-suave'}>{children}</span>
    </li>
  );
}
