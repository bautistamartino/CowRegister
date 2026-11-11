import { execSync } from 'node:child_process';

// Antes de todos los tests: crea la base de tests (si no existe) y le aplica
// todas las migraciones, así siempre tiene la misma estructura que la real.
export default function setup() {
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: process.env, // DATABASE_URL ya apunta a cowregister_test (ver vitest.config.ts)
  });
}
