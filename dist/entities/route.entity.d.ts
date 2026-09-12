import { Stop } from './stop.entity';
export declare class Route {
    id: string;
    depotId: string;
    driverId: string;
    shiftId: string | null;
    dispatcherId: string | null;
    routeDate: string;
    totalDistanceKm: number;
    totalEstimatedTimeMin: number;
    status: string;
    polyline: string | null;
    createdAt: Date;
    stops: Stop[];
}
