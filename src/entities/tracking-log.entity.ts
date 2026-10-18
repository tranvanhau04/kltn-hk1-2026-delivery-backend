import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Shift } from './shift.entity';
import { User } from './user.entity';

/**
 * Maps to the `tracking_logs` table.
 *
 * Stores real-time GPS pings from driver devices.
 * Used by:
 *   - TrackingController (REST): POST /api/driver/location
 *   - TrackingGateway (Socket.io): 'update_location' event
 */
@Entity('tracking_logs')
export class TrackingLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK → drivers(user_id) */
  @Column({ name: 'driver_id', type: 'varchar', length: 36 })
  driverId: string;

  /** FK → shifts(id) — nullable (driver may not have an open shift yet) */
  @Column({ name: 'shift_id', type: 'varchar', length: 36, nullable: true })
  shiftId: string | null;

  @Column({ name: 'latitude', type: 'decimal', precision: 10, scale: 7 })
  latitude: number;

  @Column({ name: 'longitude', type: 'decimal', precision: 10, scale: 7 })
  longitude: number;

  /** Device battery level (0–100). Nullable for backward compatibility. */
  @Column({ name: 'battery_level', type: 'int', nullable: true })
  batteryLevel: number | null;

  /** Kept for backward compat with REST controller */
  @Column({ name: 'timestamp', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  timestamp: Date;

  /** Canonical created_at — used by Socket.io gateway */
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // ─── Relations ─────────────────────────────────────────────────────────────

  @ManyToOne(() => Shift, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'shift_id' })
  shift: Shift | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driver_id', referencedColumnName: 'id' })
  driver: User | null;
}
