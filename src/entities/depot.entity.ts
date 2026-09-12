import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('depots')
export class Depot {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'address', type: 'text' })
  address: string;

  @Column({ name: 'latitude', type: 'decimal', precision: 10, scale: 7 })
  latitude: number;

  @Column({ name: 'longitude', type: 'decimal', precision: 10, scale: 7 })
  longitude: number;
}
