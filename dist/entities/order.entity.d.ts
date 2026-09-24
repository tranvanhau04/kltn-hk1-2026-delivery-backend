export declare enum OrderStatus {
    NEW = "NEW",
    ASSIGNED = "ASSIGNED",
    IN_TRANSIT = "IN_TRANSIT",
    DELIVERED = "DELIVERED",
    FAILED = "FAILED"
}
export declare class Order {
    id: string;
    code: string;
    dispatcherId: string | null;
    zoneId: string | null;
    receiverName: string;
    receiverPhone: string;
    deliveryAddress: string;
    latitude: number;
    longitude: number;
    weightKg: number;
    volumeM3: number;
    codAmount: number;
    status: OrderStatus;
    createdAt: Date;
    updatedAt: Date;
}
