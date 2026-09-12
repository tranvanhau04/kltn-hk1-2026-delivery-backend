import { Entity, Column, PrimaryColumn, OneToMany } from 'typeorm';
import { Stop } from './stop.entity';

@Entity('routes')
export class Route {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'depot_id', type: 'varchar', length: 36 })
  depotId: string;

  @Column({ name: 'driver_id', type: 'varchar', length: 36 })
  driverId: string;

  @Column({ name: 'shift_id', type: 'varchar', length: 36, nullable: true })
  shiftId: string | null;

  @Column({ name: 'dispatcher_id', type: 'varchar', length: 36, nullable: true })
  dispatcherId: string | null;

  @Column({ name: 'route_date', type: 'date' })
  routeDate: string;

  @Column({ name: 'total_distance_km', type: 'decimal', precision: 8, scale: 2, default: 0 })
  totalDistanceKm: number;

  @Column({ name: 'total_estimated_time_min', type: 'decimal', precision: 8, scale: 2, default: 0 })
  totalEstimatedTimeMin: number;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'PLANNED' })
  status: string;

  @Column({ name: 'polyline', type: 'text', nullable: true })
  polyline: string | null;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @OneToMany(() => Stop, (stop) => stop.routeId)
  stops: Stop[];
}
