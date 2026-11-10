import type { InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  etiqueta: string;
  error?: string;
  ayuda?: string;
};

// Campo de formulario con etiqueta, texto de ayuda y mensaje de error.
export function Campo({ etiqueta, error, ayuda, id, ...input }: Props) {
  const campoId = id ?? input.name;
  return (
    <div className="campo">
      <label htmlFor={campoId}>{etiqueta}</label>
      <input id={campoId} aria-invalid={!!error} {...input} />
      {error ? <span className="campo-error">{error}</span> : ayuda && <span className="campo-ayuda">{ayuda}</span>}
    </div>
  );
}
