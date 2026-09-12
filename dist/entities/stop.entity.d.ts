import { Order } from './order.entity';
export declare class Stop {
    id: string;
    routeId: string;
    orderId: string;
    sequenceNo: number;
    arrivedAt: Date | null;
    status: string;
    order: Order;
}
