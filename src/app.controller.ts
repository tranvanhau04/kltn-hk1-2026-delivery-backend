import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/decorators/public.decorator';
import { CurrentUser } from './auth/decorators/current-user.decorator';
import type { JwtPayload } from './auth/interfaces/jwt-payload.interface';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  getHealth() {
    return { status: 'ok' };
  }

  @Get('profile')
  getProfile(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
