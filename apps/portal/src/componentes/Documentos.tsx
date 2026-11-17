import { useRef, useState } from 'react';
import { validarArchivo, type VistaPortal } from '../fuente/tipos';
import { NOMBRE_DOCUMENTO } from './marca';

export function Documentos({
  vista, ocupado, alSubir,
}: { vista: VistaPortal; ocupado: boolean; alSubir: (f: File) => void }) {
  const [sobre, setSobre] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const faltan = vista.pendientes.filter((p) => p.tipo === 'faltante' || p.tipo === 'ilegible' || p.tipo === 'vencido');

  const elegir = (f: File | undefined) => {
    if (!f) return;
    const e = validarArchivo(f);
    setError(e);
    if (!e) alSubir(f);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => { e.preventDefault(); setSobre(false); elegir(e.dataTransfer.files?.[0]); }}
        className={`rounded-2xl border-2 border-dashed p-6 text-center ${sobre ? 'border-marca bg-marca-claro' : 'border-borde bg-white'}`}
      >
        <p className="text-[15px] font-medium">Arrastre aquí una foto o un PDF</p>
        <p className="mt-1 text-sm text-tinta-suave">JPG, PNG, WEBP o PDF de hasta 10 MB. Procure buena luz y que el documento se vea completo.</p>
        <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
          onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" disabled={ocupado} onClick={() => entrada.current?.click()}
          className="mt-4 rounded-full bg-marca px-5 py-2.5 text-sm font-medium text-sobre-marca disabled:opacity-40">
          {ocupado ? 'Procesando…' : 'Elegir archivo'}
        </button>
        {error && <p className="mt-3 text-sm text-error" role="alert">{error}</p>}
      </div>

      <section className="rounded-2xl border border-borde bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold">Recibidos</h3>
        {vista.documentos.length === 0 ? <p className="text-sm text-tinta-suave">Aún no ha enviado documentos.</p> : (
          <ul className="space-y-2">
            {vista.documentos.map((d, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-[15px]">
                <span>{NOMBRE_DOCUMENTO[d.clave] ?? d.clave.replace(/_/g, ' ')}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${d.estado === 'requiere reenvío' ? 'bg-error-claro text-error' : 'bg-ok-claro text-ok'}`}>
                  {d.estado === 'requiere reenvío' ? 'Enviar de nuevo' : 'Recibido'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {faltan.length > 0 && (
        <section className="rounded-2xl border border-borde bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Aún falta</h3>
          <ul className="list-disc space-y-1 pl-5 text-[15px]">{faltan.map((p, i) => <li key={i}>{p.descripcion}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
