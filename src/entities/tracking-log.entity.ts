import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('tracking_logs')
export class TrackingLog {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'driver_id', type: 'varchar', length: 36 })
  driverId: string;

  @Column({ name: 'shift_id', type: 'varchar', length: 36, nullable: true })
  shiftId: string | null;

  @Column({ name: 'latitude', type: 'decimal', precision: 10, scale: 7 })
  latitude: number;

  @Column({ name: 'longitude', type: 'decimal', precision: 10, scale: 7 })
  longitude: number;

  @Column({ name: 'timestamp', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  timestamp: Date;
}
