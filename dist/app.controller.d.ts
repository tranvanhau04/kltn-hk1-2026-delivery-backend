import { AppService } from './app.service';
import type { JwtPayload } from './auth/interfaces/jwt-payload.interface';
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getHello(): string;
    getHealth(): {
        status: string;
    };
    getProfile(user: JwtPayload): JwtPayload;
}
