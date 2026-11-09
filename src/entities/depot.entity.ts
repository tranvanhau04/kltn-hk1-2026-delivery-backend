import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Region } from './region.entity';

@Entity('depots')
export class Depot {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'region_id', type: 'varchar', length: 36, nullable: true })
  regionId: string;

  @ManyToOne(() => Region, (region) => region.hubs, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'region_id' })
  region: Region;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'address', type: 'text' })
  address: string;

  @Column({ name: 'latitude', type: 'decimal', precision: 10, scale: 7 })
  latitude: number;

  @Column({ name: 'longitude', type: 'decimal', precision: 10, scale: 7 })
  longitude: number;
}
