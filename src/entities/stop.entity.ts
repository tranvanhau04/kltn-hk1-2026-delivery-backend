import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Order } from './order.entity';

@Entity('stops')
export class Stop {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'route_id', type: 'varchar', length: 36 })
  routeId: string;

  @Column({ name: 'order_id', type: 'varchar', length: 36 })
  orderId: string;

  @Column({ name: 'sequence_no', type: 'int' })
  sequenceNo: number;

  @Column({ name: 'arrived_at', type: 'timestamp', nullable: true })
  arrivedAt: Date | null;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'PENDING' })
  status: string;

  @ManyToOne(() => Order, { eager: true })
  @JoinColumn({ name: 'order_id' })
  order: Order;
}
