import { Shift } from './shift.entity';
import { User } from './user.entity';
export declare class TrackingLog {
    id: string;
    driverId: string;
    shiftId: string | null;
    latitude: number;
    longitude: number;
    batteryLevel: number | null;
    timestamp: Date;
    createdAt: Date;
    shift: Shift | null;
    driver: User | null;
}
