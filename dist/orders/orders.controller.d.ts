import { OrdersService } from './orders.service';
import { UpdateCoordinatesDto } from './dto/update-coordinates.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order, OrderStatus } from '../entities/order.entity';
export declare class OrdersController {
    private readonly ordersService;
    constructor(ordersService: OrdersService);
    create(dto: CreateOrderDto): Promise<Order>;
    findAll(query: QueryOrderDto): Promise<{
        data: Order[];
        total: number;
    }>;
    findPool(hubId?: string, regionId?: string): Promise<Order[]>;
    getDriverOrdersToday(driverId: string): Promise<Order[]>;
    findOne(id: string): Promise<Order>;
    updateCoordinates(id: string, dto: UpdateCoordinatesDto): Promise<Order>;
    updateStatus(id: string, status: OrderStatus, note?: string, driverId?: string): Promise<Order>;
    assignDriver(id: string, driverId: string, note?: string): Promise<Order>;
    importExcel(file: Express.Multer.File): Promise<{
        totalRows: number;
        importedCount: number;
        failedCount: number;
        errors: string[];
    } | {
        statusCode: number;
        message: string;
        stack: string | undefined;
    }>;
}
