// Spec 015 (T5): la lista blanca de la constitución tiene que coincidir con la del código.
// Si alguien agrega una clave a `listaBlanca.ts` sin ampliar la constitución (que exige la aprobación
// del responsable), este test falla.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLAVES_DETALLE, CLAVES_USUARIO_DETALLE } from '../src/admin/listaBlanca.js';

const constitucion = readFileSync(resolve(__dirname, '../../docs/constitution.md'), 'utf8').toLowerCase();

// Cada clave del código, con la expresión con la que la constitución la nombra.
const NOMBRES: Record<string, string> = {
  id: 'id',
  nombre: 'nombre',
  email: 'email',
  rol: 'rol',
  activo: 'activo',
  creadoEn: 'fecha de alta',
  dueno: 'dueño',
  duenosAdicionales: 'dueño',
  usuariosActivos: 'cantidad de usuarios activos',
  animalesActivos: 'cantidad de animales activos',
  estado: 'estado del tambo',
  ultimoCambioEstado: 'última baja',
  ultimoIngreso: 'último ingreso',
  usuarios: 'lista de usuarios',
};

describe('constitución: lista blanca del administrador', () => {
  it('nombra cada clave que el código le devuelve al administrador', () => {
    const claves = new Set<string>([...CLAVES_DETALLE, ...CLAVES_USUARIO_DETALLE]);
    for (const clave of claves) {
      const nombre = NOMBRES[clave];
      expect(nombre, `falta mapear la clave nueva "${clave}" a su texto en la constitución`).toBeTruthy();
      expect(constitucion, `la constitución no menciona "${nombre}" (clave ${clave})`).toContain(nombre);
    }
  });

  it('deja constancia de la aprobación de la spec 015 y del motivo, quién y cuándo', () => {
    expect(constitucion).toContain('015');
    expect(constitucion).toContain('motivo');
    expect(constitucion).toContain('última reactivación');
    expect(constitucion).toContain('identificador de ruta');
  });
});
