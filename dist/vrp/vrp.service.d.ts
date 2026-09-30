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
    timeWindowStart?: number;
    timeWindowEnd?: number;
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
    volumeM3: number;
    codAmount: number;
    estimatedArrivalMin: number | null;
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
    totalVolumeM3: number;
    polyline: [number, number][];
}
export interface VrpUnassignedOrder {
    orderId: string;
    code: string;
    reason: string;
}
export interface VrpSolutionResult {
    routes: VrpRouteResult[];
    totalDistanceKm: number;
    totalOrders: number;
    assignedOrders: number;
    unassignedOrders: VrpUnassignedOrder[];
    optimizationTimeMs: number;
    depot: VrpDepot;
    algorithmUsed: string;
}
export declare class VrpService {
    private readonly logger;
    solve(depot: VrpDepot, orders: VrpOrder[], drivers: VrpDriver[]): Promise<VrpSolutionResult>;
}
