import type { AnimalCopia, CopiaLocal, Perfil } from '../compartido/api';
import { ErrorSinEspacio, type Almacen, type AvisoGuardado, type Enviado, type MetaCopia, type Pendiente, type Propietario } from './almacen';

// Almacén en memoria: solo para los tests. Imita lo importante del real: reemplazar la copia es
// "todo o nada", y se pueden simular fallas.
export class AlmacenMemoria implements Almacen {
  private meta: MetaCopia | null = null;
  private animales: AnimalCopia[] = [];
  private perfil: Perfil | null = null;

  // Fallas simuladas (se activan con `configurar`):
  //   capacidad: cantidad máxima de animales que entran; si la copia trae más, "no hay espacio".
  //   fallarEnAnimal: se rompe al escribir ese animal (posición desde 0), o sea "a mitad".
  private capacidad = Infinity;
  private fallarEnAnimal: number | null = null;

  // Pendientes y enviados (por id; Map conserva el orden de inserción).
  private pendientes = new Map<string, Pendiente>();
  private enviados = new Map<string, Enviado>();
  private avisos = new Map<string, AvisoGuardado>();
  // capacidadPendientes: cuántos pendientes entran; el siguiente da "no hay espacio" (navegador lleno).
  private capacidadPendientes = Infinity;

  configurar(fallas: { capacidad?: number; fallarEnAnimal?: number; capacidadPendientes?: number }): void {
    this.capacidad = fallas.capacidad ?? Infinity;
    this.fallarEnAnimal = fallas.fallarEnAnimal ?? null;
    this.capacidadPendientes = fallas.capacidadPendientes ?? Infinity;
  }

  async leerMeta(): Promise<MetaCopia | null> {
    return this.meta;
  }

  async leerAnimales(): Promise<AnimalCopia[]> {
    return this.animales;
  }

  async reemplazarCopia(copia: CopiaLocal, propietario: Propietario): Promise<void> {
    // Se escribe en un lugar APARTE ("borrador") y recién al final se cambia de un golpe,
    // como hace la transacción de IndexedDB. Si algo falla antes, lo anterior queda como estaba.
    const borrador: AnimalCopia[] = [];
    for (const [posicion, animal] of copia.animales.entries()) {
      if (borrador.length >= this.capacidad) throw new ErrorSinEspacio();
      if (this.fallarEnAnimal === posicion) throw new Error('Falla simulada a mitad de la escritura');
      borrador.push(animal);
    }
    this.animales = borrador;
    this.meta = { generadaEn: copia.generadaEn, totalAnimales: copia.totalAnimales, lotes: copia.lotes, propietario, ...(copia.semen && { semen: copia.semen }) };
  }

  async borrarCopia(): Promise<void> {
    this.meta = null;
    this.animales = [];
  }

  async leerPerfil(): Promise<Perfil | null> {
    return this.perfil;
  }

  async guardarPerfil(perfil: Perfil): Promise<void> {
    this.perfil = perfil;
  }

  async borrarTodo(): Promise<void> {
    this.meta = null;
    this.animales = [];
    this.perfil = null;
    this.pendientes.clear();
    this.enviados.clear();
    this.avisos.clear();
  }

  async listarPendientes(): Promise<Pendiente[]> {
    return [...this.pendientes.values()].map((p) => ({ ...p })); // copias: quien lee no cambia lo guardado
  }

  async guardarPendiente(pendiente: Pendiente): Promise<void> {
    if (!this.pendientes.has(pendiente.id) && this.pendientes.size >= this.capacidadPendientes) throw new ErrorSinEspacio();
    this.pendientes.set(pendiente.id, { ...pendiente });
  }

  async borrarPendiente(id: string): Promise<void> {
    this.pendientes.delete(id);
  }

  async aceptarPendiente(id: string, enviado: Enviado, avisos: AvisoGuardado | null): Promise<void> {
    this.pendientes.delete(id);
    this.enviados.set(enviado.id, { ...enviado });
    if (avisos) this.avisos.set(avisos.id, { ...avisos });
  }

  async listarEnviados(): Promise<Enviado[]> {
    return [...this.enviados.values()].map((e) => ({ ...e }));
  }

  async guardarEnviado(enviado: Enviado): Promise<void> {
    this.enviados.set(enviado.id, { ...enviado });
  }

  async borrarEnviados(ids: string[]): Promise<void> {
    for (const id of ids) this.enviados.delete(id);
  }

  async listarAvisos(): Promise<AvisoGuardado[]> {
    return [...this.avisos.values()].map((a) => ({ ...a }));
  }

  async guardarAvisos(avisos: AvisoGuardado): Promise<void> {
    this.avisos.set(avisos.id, { ...avisos });
  }

  async borrarAvisos(ids: string[]): Promise<void> {
    for (const id of ids) this.avisos.delete(id);
  }
}
