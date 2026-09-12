import { Repository } from 'typeorm';
import { VrpService, VrpSolutionResult } from './vrp.service';
import { Order } from '../entities/order.entity';
import { Driver } from '../entities/driver.entity';
import { Depot } from '../entities/depot.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { User } from '../entities/user.entity';
interface OptimizeDto {
    depotId?: string;
    orderIds: string[];
    driverIds?: string[];
}
interface ConfirmRouteDto {
    depotId: string;
    driverId: string;
    stops: Array<{
        orderId: string;
        sequenceNo: number;
        latitude: number;
        longitude: number;
    }>;
    totalDistanceKm: number;
    totalEstimatedTimeMin: number;
    polyline: [number, number][];
}
interface ConfirmDto {
    routes: ConfirmRouteDto[];
}
export declare class VrpController {
    private readonly vrpService;
    private readonly orderRepo;
    private readonly driverRepo;
    private readonly depotRepo;
    private readonly routeRepo;
    private readonly stopRepo;
    private readonly userRepo;
    constructor(vrpService: VrpService, orderRepo: Repository<Order>, driverRepo: Repository<Driver>, depotRepo: Repository<Depot>, routeRepo: Repository<Route>, stopRepo: Repository<Stop>, userRepo: Repository<User>);
    optimize(dto: OptimizeDto): Promise<VrpSolutionResult>;
    confirm(dto: ConfirmDto): Promise<{
        message: string;
        routeIds: string[];
    }>;
}
export {};
