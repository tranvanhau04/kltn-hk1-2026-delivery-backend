import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('orders')
export class Order {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'code', type: 'varchar', length: 50 })
  code: string;

  @Column({ name: 'dispatcher_id', type: 'varchar', length: 36, nullable: true })
  dispatcherId: string | null;

  @Column({ name: 'zone_id', type: 'varchar', length: 36, nullable: true })
  zoneId: string | null;

  @Column({ name: 'receiver_name', type: 'varchar', length: 100 })
  receiverName: string;

  @Column({ name: 'receiver_phone', type: 'varchar', length: 20 })
  receiverPhone: string;

  @Column({ name: 'delivery_address', type: 'text' })
  deliveryAddress: string;

  @Column({ name: 'latitude', type: 'decimal', precision: 10, scale: 7 })
  latitude: number;

  @Column({ name: 'longitude', type: 'decimal', precision: 10, scale: 7 })
  longitude: number;

  @Column({ name: 'weight_kg', type: 'decimal', precision: 8, scale: 2 })
  weightKg: number;

  @Column({ name: 'volume_m3', type: 'decimal', precision: 8, scale: 3 })
  volumeM3: number;

  @Column({ name: 'cod_amount', type: 'decimal', precision: 12, scale: 2, default: 0 })
  codAmount: number;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'NEW' })
  status: string;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
