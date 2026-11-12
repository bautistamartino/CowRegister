import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// El service worker es un archivo estático (web/public/sw.js). Para probar su lógica pura se ejecuta en un
// contexto aislado con un `self` falso, y se lee la función `esPaginaDeLaApp` que declara.
const codigo = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const contexto: Record<string, unknown> = { self: { addEventListener() {}, location: { origin: 'http://x' } } };
createContext(contexto);
runInContext(codigo, contexto);
const esPaginaDeLaApp = contexto.esPaginaDeLaApp as (html: string) => boolean;

describe('esPaginaDeLaApp (service worker, corrección I-2)', () => {
  it('acepta la página compilada de la app', () => {
    const html = '<html><body><div id="root"></div><script type="module" src="/assets/index-abc123.js"></script></body></html>';
    expect(esPaginaDeLaApp(html)).toBe(true);
  });

  it('rechaza un portal cautivo de WiFi (200 con HTML ajeno)', () => {
    expect(esPaginaDeLaApp('<html><body><form action="/login">Aceptá los términos del WiFi</form></body></html>')).toBe(false);
  });

  it('rechaza vacío o sin los archivos de la app', () => {
    expect(esPaginaDeLaApp('')).toBe(false);
    expect(esPaginaDeLaApp('<div id="root"></div>')).toBe(false);
  });

  it('el nombre de la caché lleva el sello de build (se reemplaza al compilar)', () => {
    expect(codigo).toMatch(/const CACHE = 'cowregister-app-__BUILD__'/);
  });
});
