import { Region } from './region.entity';
export declare class Depot {
    id: string;
    regionId: string;
    region: Region;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
}
