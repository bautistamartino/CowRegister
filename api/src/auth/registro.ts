import { prisma } from '../db.js';
import { normalizarNombre } from '../validacion.js';
import { crearLotesIniciales } from '../lotes/iniciales.js';

export interface DatosTamboNuevo {
  nombreEstablecimiento: string;
  nombre: string;
  email: string;
  passwordHash: string; // ya hasheada: esta función nunca ve la contraseña
}

// Registra un tambo nuevo en UNA transacción (RF-18, todo o nada):
// establecimiento, sus 4 lotes iniciales con sus destinos y, por último, el
// usuario dueño. Si cualquier paso falla (por ejemplo, un email repetido al
// crear el dueño), PostgreSQL deshace todo y no queda nada guardado.
// No verifica si el email o el nombre existen: lo hace la ruta antes y, si dos pedidos llegan a la
// vez, la base los rechaza (P2002) y la ruta lo traduce a 409 con admin/choques.ts.
export function crearTamboConDueno(datos: DatosTamboNuevo) {
  return prisma.$transaction(async (tx) => {
    const establecimiento = await tx.establecimiento.create({
      // Nombre normalizado (NFC y espacios colapsados): el índice único de la base lo compara así.
      data: { nombre: normalizarNombre(datos.nombreEstablecimiento) },
    });
    await crearLotesIniciales(tx, establecimiento.id);
    return tx.usuario.create({
      data: {
        establecimientoId: establecimiento.id,
        nombre: datos.nombre,
        email: datos.email,
        passwordHash: datos.passwordHash,
        rol: 'DUENO',
      },
    });
  });
}
