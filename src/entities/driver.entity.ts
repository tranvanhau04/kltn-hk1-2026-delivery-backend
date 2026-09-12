import { Entity, Column, PrimaryColumn } from 'typeorm';

/**
 * Flat view of driver joined with user info.
 * Maps to the `drivers` table; full name is fetched via query joining users.
 */
@Entity('drivers')
export class Driver {
  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @Column({ name: 'license_plate', type: 'varchar', length: 20 })
  licensePlate: string;

  @Column({ name: 'vehicle_type', type: 'varchar', length: 30 })
  vehicleType: string;

  @Column({ name: 'max_weight_kg', type: 'decimal', precision: 8, scale: 2 })
  maxWeightKg: number;

  @Column({ name: 'max_volume_m3', type: 'decimal', precision: 8, scale: 3 })
  maxVolumeM3: number;

  @Column({
    name: 'current_shift_status',
    type: 'varchar',
    length: 20,
    default: 'OFFLINE',
  })
  currentShiftStatus: string;
}
