export declare enum UserRole {
    ADMIN = "ADMIN",
    DISPATCHER = "DISPATCHER",
    DRIVER = "DRIVER"
}
export declare enum UserStatus {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE",
    LOCKED = "LOCKED"
}
export declare class User {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    passwordHash: string;
    role: UserRole;
    status: UserStatus;
    createdAt: Date;
    updatedAt: Date;
}
