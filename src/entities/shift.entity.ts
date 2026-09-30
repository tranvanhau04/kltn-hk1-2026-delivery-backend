import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Driver } from './driver.entity';

export enum ShiftStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

/**
 * Represents a driver's working shift.
 * Maps to the `shifts` table.
 *
 * A shift tracks:
 *  - The owning driver (FK → drivers.user_id)
 *  - Start / end timestamps
 *  - OPEN/CLOSED lifecycle status
 *  - Starting cash COD balance for the shift
 *  - Driver GPS position at shift boundaries (optional)
 */
@Entity('shifts')
export class Shift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK references drivers(user_id) — drivers.userId is the PK of the drivers table */
  @Column({ name: 'driver_id', type: 'varchar', length: 36 })
  driverId: string;

  @Column({
    name: 'start_time',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamp', nullable: true })
  endTime: Date | null;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 10,
    default: ShiftStatus.OPEN,
  })
  status: ShiftStatus;

  @Column({
    name: 'starting_cash_cod',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  startingCashCod: number;

  @Column({
    name: 'current_latitude',
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  currentLatitude: number | null;

  @Column({
    name: 'current_longitude',
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  currentLongitude: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /** Many shifts belong to one driver */
  @ManyToOne(() => Driver, (driver) => driver.shifts)
  @JoinColumn({ name: 'driver_id', referencedColumnName: 'userId' })
  driver: Driver;
}
