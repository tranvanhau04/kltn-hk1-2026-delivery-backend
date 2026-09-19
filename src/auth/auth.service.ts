import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserStatus } from '../entities/user.entity';
import { PasswordReset } from '../entities/password-reset.entity';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(PasswordReset)
    private readonly passwordResetRepository: Repository<PasswordReset>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Validate user credentials against database.
   * Loads passwordHash explicitly via QueryBuilder since select: false on the entity.
   */
  async validateUser(email: string, pass: string): Promise<User> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: normalizedEmail })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('User account is not active');
    }

    return user;
  }

  /**
   * Login user and issue Access Token + Refresh Token.
   */
  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    const accessPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };

    const refreshPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'refresh',
    };

    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload),
      this.jwtService.signAsync(refreshPayload, {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn as any,
      }),
    ]);

    const { passwordHash, ...safeUser } = user;

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '1d',
      user: safeUser,
    };
  }

  /**
   * Handle Forgot Password request (KLTN-36).
   * - Normalizes email
   * - Neutral OWASP response for non-existent or inactive accounts
   * - Revokes previous active reset requests
   * - Generates 6-digit OTP (crypto) and random token (crypto)
   * - Stores SHA-256 hashes of OTP and token
   * - Dispatches email notification
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const neutralResponse = {
      statusCode: 200,
      message:
        'If this email is registered in our system, a password reset code has been sent.',
    };

    const normalizedEmail = dto.email.trim().toLowerCase();

    // Look up user
    const user = await this.userRepository.findOne({
      where: { email: normalizedEmail },
    });

    // Neutral response if user does not exist or is not ACTIVE (OWASP Email Enumeration Protection)
    if (!user || user.status !== UserStatus.ACTIVE) {
      return neutralResponse;
    }

    // Revoke all previous unused reset requests for this email
    await this.passwordResetRepository.update(
      { email: normalizedEmail, isUsed: false },
      { isUsed: true },
    );

    // Generate cryptographic 6-digit OTP and 32-byte hex token
    const otp = crypto.randomInt(100000, 1000000).toString();
    const token = crypto.randomBytes(32).toString('hex');

    // SHA-256 hash before storing in database
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const expireMinutes =
      Number(this.configService.get<string>('RESET_PASSWORD_EXPIRES_MINUTES')) || 15;
    const expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000);

    const resetRecord = this.passwordResetRepository.create({
      id: crypto.randomUUID(),
      email: normalizedEmail,
      otpHash,
      tokenHash,
      expiresAt,
      isUsed: false,
    });

    await this.passwordResetRepository.save(resetRecord);

    // Construct web reset link
    const frontendUrl =
      this.configService.get<string>('FRONTEND_RESET_PASSWORD_URL') ||
      'http://localhost:3000/reset-password';
    const resetLink = `${frontendUrl}?token=${token}&email=${encodeURIComponent(normalizedEmail)}`;

    // Dispatch email
    await this.mailService.sendPasswordResetEmail(normalizedEmail, otp, resetLink);

    const isDev =
      (this.configService.get<string>('NODE_ENV') || 'development') === 'development';

    if (isDev) {
      return {
        statusCode: 200,
        message:
          'If this email is registered in our system, a password reset code has been sent.',
        debugOtp: otp,
        debugResetLink: resetLink,
      };
    }

    return neutralResponse;
  }

  /**
   * Handle Reset Password request (KLTN-37).
   * - Enforces exactly one of otp or token
   * - Hashes code with SHA-256
   * - Executes in a Database Transaction with Pessimistic Locking (SELECT ... FOR UPDATE)
   * - Atomically verifies reset record, checks user ACTIVE, hashes new password with bcrypt,
   *   updates users table, and revokes/consumes all reset records for this email.
   */
  async resetPassword(dto: ResetPasswordDto) {
    // 1. Enforce exactly one of otp or token
    if ((!dto.otp && !dto.token) || (dto.otp && dto.token)) {
      throw new BadRequestException('Provide either otp or token, but not both');
    }

    const normalizedEmail = dto.email.trim().toLowerCase();
    const rawCode = dto.otp ? dto.otp.trim() : dto.token!.trim();
    const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');

    // 2. Database Transaction with Atomicity & Pessimistic Locking
    return await this.dataSource.transaction(async (manager) => {
      const qb = manager
        .getRepository(PasswordReset)
        .createQueryBuilder('pr')
        .setLock('pessimistic_write')
        .where('pr.email = :email', { email: normalizedEmail })
        .andWhere('pr.isUsed = :isUsed', { isUsed: false });

      if (dto.otp) {
        qb.andWhere('pr.otpHash = :codeHash', { codeHash });
      } else {
        qb.andWhere('pr.tokenHash = :codeHash', { codeHash });
      }

      const resetRecord = await qb.getOne();

      if (!resetRecord) {
        throw new BadRequestException('Invalid or expired reset code');
      }

      if (new Date() > resetRecord.expiresAt) {
        throw new BadRequestException('Reset code has expired');
      }

      // 3. Verify user existence and ACTIVE status
      const user = await manager.findOne(User, {
        where: { email: normalizedEmail },
      });

      if (!user || user.status !== UserStatus.ACTIVE) {
        throw new BadRequestException('User account is not active or does not exist');
      }

      // 4. Hash new password with bcrypt 10 rounds
      const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);

      // 5. Update user password
      await manager.update(User, { id: user.id }, { passwordHash: newPasswordHash });

      // 6. Invalidate current reset record and revoke all remaining unused reset records for this email
      await manager.update(
        PasswordReset,
        { email: normalizedEmail, isUsed: false },
        { isUsed: true },
      );

      return {
        statusCode: 200,
        message:
          'Password has been reset successfully. You can now login with your new password.',
      };
    });
  }
}
