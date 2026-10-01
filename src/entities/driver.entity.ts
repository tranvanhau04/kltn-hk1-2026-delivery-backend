import { Entity, Column, PrimaryColumn, OneToMany } from 'typeorm';
import { Shift } from './shift.entity';

export enum DriverShiftStatus {
  OFFLINE = 'OFFLINE',
  ONLINE_READY = 'ONLINE_READY',
  BUSY = 'BUSY',
  ON_DUTY = 'ON_DUTY',
}

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

  /** Relation: one driver has many shifts (lazy-loaded by default via ShiftsService) */
  @OneToMany(() => Shift, (shift) => shift.driver)
  shifts: Shift[];
}
