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
 * Maps to the `shifts` table.
 *
 * Pre-existing columns (from initial DB schema):
 *   id, driver_id, start_time, end_time, status,
 *   cod_collected, cod_submitted, reconciled_by, reconciled_at
 *
 * Added by Task 7.1 ALTER TABLE (migration):
 *   starting_cash_cod, current_latitude, current_longitude,
 *   created_at, updated_at
 */
@Entity('shifts')
export class Shift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK → drivers(user_id) */
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
    length: 20,
    default: ShiftStatus.OPEN,
  })
  status: ShiftStatus;

  // ─── Task 7.1 columns (added via ALTER TABLE) ──────────────────────────────

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

  // ─── Pre-existing columns (from initial DB schema) ─────────────────────────

  @Column({
    name: 'cod_collected',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  codCollected: number;

  @Column({
    name: 'cod_submitted',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  codSubmitted: number;

  @Column({ name: 'reconciled_by', type: 'varchar', length: 36, nullable: true })
  reconciledBy: string | null;

  @Column({ name: 'reconciled_at', type: 'timestamp', nullable: true })
  reconciledAt: Date | null;

  // ─── Relation ──────────────────────────────────────────────────────────────

  /** Many shifts belong to one driver */
  @ManyToOne(() => Driver, (driver) => driver.shifts)
  @JoinColumn({ name: 'driver_id', referencedColumnName: 'userId' })
  driver: Driver;
}

