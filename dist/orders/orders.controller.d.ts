import { Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
export declare class OrdersController {
    private readonly orderRepo;
    constructor(orderRepo: Repository<Order>);
    findPool(): Promise<Order[]>;
    findAll(): Promise<Order[]>;
}
