import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * Maps to the `zone_drivers` join table (pre-existing schema).
 * Columns: zone_id VARCHAR(36), driver_id VARCHAR(36), assigned_at TIMESTAMP
 * Composite PK: (zone_id, driver_id)
 */
@Entity('zone_drivers')
export class ZoneDriver {
  @PrimaryColumn({ name: 'zone_id', type: 'varchar', length: 36 })
  zoneId: string;

  @PrimaryColumn({ name: 'driver_id', type: 'varchar', length: 36 })
  driverId: string;

  @CreateDateColumn({ name: 'assigned_at', type: 'timestamp' })
  assignedAt: Date;
}
