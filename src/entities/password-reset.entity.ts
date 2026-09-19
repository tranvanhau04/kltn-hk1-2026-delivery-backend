import { Entity, Column, PrimaryColumn, Index, CreateDateColumn } from 'typeorm';

@Entity('password_resets')
export class PasswordReset {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Index('idx_password_resets_email')
  @Column({ name: 'email', type: 'varchar', length: 150 })
  email: string;

  @Column({ name: 'otp_hash', type: 'varchar', length: 64 })
  otpHash: string;

  @Index('idx_password_resets_token_hash')
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @Column({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
