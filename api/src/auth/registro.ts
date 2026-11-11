import { prisma } from '../db.js';
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
// No verifica si el email existe: eso lo hace la ruta antes, para responder 409.
export function crearTamboConDueno(datos: DatosTamboNuevo) {
  return prisma.$transaction(async (tx) => {
    const establecimiento = await tx.establecimiento.create({
      data: { nombre: datos.nombreEstablecimiento },
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
