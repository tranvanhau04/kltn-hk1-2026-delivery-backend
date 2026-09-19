import { OrdersService } from './orders.service';
import { UpdateCoordinatesDto } from './dto/update-coordinates.dto';
import { Order } from '../entities/order.entity';
export declare class OrdersController {
    private readonly ordersService;
    constructor(ordersService: OrdersService);
    findAll(): Promise<Order[]>;
    findPool(): Promise<Order[]>;
    findOne(id: string): Promise<Order>;
    updateCoordinates(id: string, dto: UpdateCoordinatesDto): Promise<Order>;
}
