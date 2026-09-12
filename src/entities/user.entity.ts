import { Entity, Column, PrimaryColumn } from 'typeorm';

/**
 * Users table — used to get driver full_name, phone, email via JOIN.
 */
@Entity('users')
export class User {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'full_name', type: 'varchar', length: 100 })
  fullName: string;

  @Column({ name: 'email', type: 'varchar', length: 150 })
  email: string;

  @Column({ name: 'phone', type: 'varchar', length: 20 })
  phone: string;

  @Column({ name: 'role', type: 'varchar', length: 20 })
  role: string;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'ACTIVE' })
  status: string;
}
