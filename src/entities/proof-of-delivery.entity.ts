import { Entity, Column, PrimaryColumn, OneToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Stop } from './stop.entity';

@Entity('proof_of_deliveries')
export class ProofOfDelivery {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'stop_id', type: 'varchar', length: 36, unique: true })
  stopId: string;

  @Column({ name: 'photo_url', type: 'text', nullable: true })
  photoUrl: string | null;

  @Column({
    name: 'cod_collected',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  codCollected: number;

  @Column({ name: 'failure_reason', type: 'varchar', length: 255, nullable: true })
  failureReason: string | null;

  @Column({ name: 'rescheduled_date', type: 'timestamp', nullable: true })
  rescheduledDate: Date | null;

  @CreateDateColumn({ name: 'confirmed_at' })
  confirmedAt: Date;

  @OneToOne(() => Stop)
  @JoinColumn({ name: 'stop_id' })
  stop: Stop;
}
