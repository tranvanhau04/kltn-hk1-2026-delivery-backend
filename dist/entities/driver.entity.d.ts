import { Shift } from './shift.entity';
import { Depot } from './depot.entity';
export declare enum DriverShiftStatus {
    OFFLINE = "OFFLINE",
    ONLINE_READY = "ONLINE_READY",
    BUSY = "BUSY",
    ON_DUTY = "ON_DUTY"
}
export declare class Driver {
    userId: string;
    depotId: string | null;
    depot: Depot | null;
    licensePlate: string;
    vehicleType: string;
    maxWeightKg: number;
    maxVolumeM3: number;
    currentShiftStatus: string;
    shifts: Shift[];
}
