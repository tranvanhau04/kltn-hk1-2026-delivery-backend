import { Repository } from 'typeorm';
import { VrpService } from './vrp.service';
import type { VrpSolutionResult } from './vrp.service';
import { RoutesService } from '../routes/routes.service';
import type { ConfirmRoutesDto, QueryRoutesDto } from '../routes/routes.service';
import { Order } from '../entities/order.entity';
import { Driver } from '../entities/driver.entity';
import { Depot } from '../entities/depot.entity';
import { User } from '../entities/user.entity';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
interface OptimizeDto {
    depotId?: string;
    orderIds?: string[];
    driverIds?: string[];
}
export declare class VrpController {
    private readonly vrpService;
    private readonly routesService;
    private readonly orderRepo;
    private readonly driverRepo;
    private readonly depotRepo;
    private readonly userRepo;
    private readonly logger;
    constructor(vrpService: VrpService, routesService: RoutesService, orderRepo: Repository<Order>, driverRepo: Repository<Driver>, depotRepo: Repository<Depot>, userRepo: Repository<User>);
    optimize(dto: OptimizeDto, user: JwtPayload): Promise<VrpSolutionResult>;
    confirm(dto: ConfirmRoutesDto, user: JwtPayload): Promise<import("../routes/routes.service").ConfirmRoutesResult>;
    listRoutes(query: QueryRoutesDto): Promise<{
        data: object[];
        total: number;
        page: number;
        limit: number;
    }>;
    getRoute(id: string): Promise<object>;
}
export {};
