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
// Si lo crea un administrador (opciones.administradorId), el registro de auditoría TAMBO_CREADO se
// escribe en la MISMA transacción: si algo falla, no queda ni tambo, ni lotes, ni auditoría.
export function crearTamboConDueno(datos: DatosTamboNuevo, opciones: { administradorId?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    // Nombre normalizado (NFC y espacios colapsados): el índice único de la base lo compara así.
    const nombreTambo = normalizarNombre(datos.nombreEstablecimiento);
    const establecimiento = await tx.establecimiento.create({ data: { nombre: nombreTambo } });
    await crearLotesIniciales(tx, establecimiento.id);
    const dueno = await tx.usuario.create({
      data: {
        establecimientoId: establecimiento.id,
        nombre: datos.nombre,
        email: datos.email,
        passwordHash: datos.passwordHash,
        rol: 'DUENO',
      },
    });
    if (opciones.administradorId) {
      await tx.auditoriaAdmin.create({
        data: {
          accion: 'TAMBO_CREADO',
          administradorId: opciones.administradorId,
          establecimientoId: establecimiento.id,
          tamboNombre: nombreTambo,
        },
      });
    }
    return dueno;
  });
}
