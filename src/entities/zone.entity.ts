import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * Maps to the `zones` table (pre-existing schema).
 * Columns: id VARCHAR(36), name VARCHAR(100), boundary_geojson TEXT, created_at TIMESTAMP
 */
@Entity('zones')
export class Zone {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'boundary_geojson', type: 'text', nullable: true })
  boundaryGeoJson: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
