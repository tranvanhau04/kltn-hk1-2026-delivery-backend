import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { UserRole } from '../../entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not defined in environment variables');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload || !payload.role || !Object.values(UserRole).includes(payload.role)) {
      throw new UnauthorizedException('Invalid token role');
    }

    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      type: payload.type,
    };
  }
}
