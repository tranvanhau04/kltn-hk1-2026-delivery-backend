import { Shift } from './shift.entity';
export declare enum DriverShiftStatus {
    OFFLINE = "OFFLINE",
    ONLINE_READY = "ONLINE_READY",
    BUSY = "BUSY",
    ON_DUTY = "ON_DUTY"
}
export declare class Driver {
    userId: string;
    licensePlate: string;
    vehicleType: string;
    maxWeightKg: number;
    maxVolumeM3: number;
    currentShiftStatus: string;
    shifts: Shift[];
}
