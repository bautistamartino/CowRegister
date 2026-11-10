import { hash, verify } from '@node-rs/argon2';

// argon2id: algoritmo recomendado para guardar contraseñas.
// Es lento a propósito, para que adivinar contraseñas por fuerza bruta sea muy caro.
export function hashearPassword(password: string) {
  return hash(password);
}

export function verificarPassword(hashGuardado: string, password: string) {
  return verify(hashGuardado, password);
}

// Hash de una contraseña cualquiera. Se usa cuando el email no existe, para
// tardar lo mismo que con un email real y no revelar qué emails están registrados.
let hashFalso: Promise<string> | undefined;
export async function verificarPasswordFalso(password: string) {
  hashFalso ??= hash('contraseña-que-nadie-usa');
  await verify(await hashFalso, password);
  return false;
}
