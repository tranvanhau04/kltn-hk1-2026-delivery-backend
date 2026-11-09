import { Repository } from 'typeorm';
import { Depot } from '../entities/depot.entity';
export declare class DepotsController {
    private readonly depotRepo;
    constructor(depotRepo: Repository<Depot>);
    findAll(regionId?: string): Promise<Depot[]>;
}
