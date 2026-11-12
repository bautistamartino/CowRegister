import type { AnimalCopia, CopiaLocal, Perfil } from '../compartido/api';
import { ErrorSinEspacio, type Almacen, type MetaCopia, type Propietario } from './almacen';

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

  configurar(fallas: { capacidad?: number; fallarEnAnimal?: number }): void {
    this.capacidad = fallas.capacidad ?? Infinity;
    this.fallarEnAnimal = fallas.fallarEnAnimal ?? null;
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
    this.meta = { generadaEn: copia.generadaEn, totalAnimales: copia.totalAnimales, lotes: copia.lotes, propietario };
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
  }
}
