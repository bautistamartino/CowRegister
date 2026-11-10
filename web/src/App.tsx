import { useEffect, useState } from 'react';

type Salud = { estado: string; hora: string };

export function App() {
  const [salud, setSalud] = useState<Salud | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Al cargar la página, consulta a la API si está funcionando.
  useEffect(() => {
    fetch('/api/salud')
      .then((res) => {
        if (!res.ok) throw new Error(`La API respondió ${res.status}`);
        return res.json() as Promise<Salud>;
      })
      .then(setSalud)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>CowRegister</h1>
      {error && <p style={{ color: 'crimson' }}>❌ No se pudo conectar con la API: {error}</p>}
      {!error && !salud && <p>Conectando con la API…</p>}
      {salud && (
        <p>
          ✅ API conectada: estado <strong>{salud.estado}</strong> (
          {new Date(salud.hora).toLocaleString('es-AR')})
        </p>
      )}
    </main>
  );
}
