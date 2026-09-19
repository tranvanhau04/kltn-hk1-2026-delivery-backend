export declare enum DriverShiftStatus {
    OFFLINE = "OFFLINE",
    ONLINE_READY = "ONLINE_READY",
    BUSY = "BUSY"
}
export declare class Driver {
    userId: string;
    licensePlate: string;
    vehicleType: string;
    maxWeightKg: number;
    maxVolumeM3: number;
    currentShiftStatus: string;
}
