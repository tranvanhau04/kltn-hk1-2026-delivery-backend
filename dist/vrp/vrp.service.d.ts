export interface VrpDepot {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
}
export interface VrpOrder {
    id: string;
    code: string;
    receiverName: string;
    receiverPhone: string;
    deliveryAddress: string;
    latitude: number;
    longitude: number;
    weightKg: number;
    volumeM3: number;
    codAmount: number;
}
export interface VrpDriver {
    userId: string;
    fullName: string;
    phone: string;
    licensePlate: string;
    vehicleType: string;
    maxWeightKg: number;
    maxVolumeM3: number;
}
export interface VrpStopResult {
    sequenceNo: number;
    orderId: string;
    code: string;
    receiverName: string;
    receiverPhone: string;
    deliveryAddress: string;
    latitude: number;
    longitude: number;
    weightKg: number;
    codAmount: number;
}
export interface VrpRouteResult {
    driverId: string;
    driverName: string;
    licensePlate: string;
    vehicleType: string;
    color: string;
    stops: VrpStopResult[];
    totalDistanceKm: number;
    totalEstimatedTimeMin: number;
    totalWeightKg: number;
    polyline: [number, number][];
}
export interface VrpSolutionResult {
    routes: VrpRouteResult[];
    totalDistanceKm: number;
    totalOrders: number;
    optimizationTimeMs: number;
    depot: VrpDepot;
}
export declare class VrpService {
    solve(depot: VrpDepot, orders: VrpOrder[], drivers: VrpDriver[]): Promise<VrpSolutionResult>;
}
