import { OrdersService } from './orders.service';
import { UpdateCoordinatesDto } from './dto/update-coordinates.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { Order } from '../entities/order.entity';
export declare class OrdersController {
    private readonly ordersService;
    constructor(ordersService: OrdersService);
    findAll(query: QueryOrderDto): Promise<{
        data: Order[];
        total: number;
    }>;
    findPool(): Promise<Order[]>;
    findOne(id: string): Promise<Order>;
    updateCoordinates(id: string, dto: UpdateCoordinatesDto): Promise<Order>;
    importExcel(file: Express.Multer.File): Promise<{
        totalRows: number;
        importedCount: number;
        failedCount: number;
        errors: string[];
    }>;
}
