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
    status: string;
    createdAt: Date;
    updatedAt: Date;
}
