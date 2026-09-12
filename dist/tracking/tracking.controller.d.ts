import { Repository } from 'typeorm';
import { TrackingLog } from '../entities/tracking-log.entity';
import { Driver } from '../entities/driver.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { User } from '../entities/user.entity';
interface LocationDto {
    driverId: string;
    lat: number;
    lng: number;
    speed?: number;
    heading?: number;
}
export declare class TrackingController {
    private readonly logRepo;
    private readonly driverRepo;
    private readonly routeRepo;
    private readonly stopRepo;
    private readonly userRepo;
    constructor(logRepo: Repository<TrackingLog>, driverRepo: Repository<Driver>, routeRepo: Repository<Route>, stopRepo: Repository<Stop>, userRepo: Repository<User>);
    liveTracking(): Promise<{
        driverId: string;
        fullName: string;
        phone: string;
        licensePlate: string;
        vehicleType: string;
        currentShiftStatus: string;
        currentLat: number | null;
        currentLng: number | null;
        positionUnknown: boolean;
        lastUpdated: Date | null;
        activeRoute: {
            routeId: string;
            totalDistanceKm: number;
            totalEstimatedTimeMin: number;
            status: string;
            polyline: [number, number][];
        } | null;
    }[]>;
    postLocation(dto: LocationDto): Promise<{
        success: boolean;
        timestamp: Date;
    }>;
    getDriverRoute(driverId: string): Promise<{
        success: boolean;
        message: string;
        route: null;
        stops: never[];
    } | {
        success: boolean;
        route: {
            id: string;
            driverId: string;
            routeDate: string;
            totalDistanceKm: number;
            totalEstimatedTimeMin: number;
            status: string;
            polyline: [number, number][];
        };
        stops: {
            id: string;
            routeId: string;
            orderId: string;
            sequenceNo: number;
            status: string;
            arrivedAt: Date | null;
            order: {
                id: string;
                code: string;
                receiverName: string;
                receiverPhone: string;
                deliveryAddress: string;
                lat: number;
                lng: number;
                codAmount: number;
                status: string;
            } | null;
        }[];
        message?: undefined;
    }>;
    endDriverShift(driverId: string, body: any): Promise<{
        success: boolean;
    }>;
    startDriverShift(driverId: string): Promise<{
        success: boolean;
    }>;
}
export {};
