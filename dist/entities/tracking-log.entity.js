"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrackingLog = void 0;
const typeorm_1 = require("typeorm");
const shift_entity_1 = require("./shift.entity");
const user_entity_1 = require("./user.entity");
let TrackingLog = class TrackingLog {
    id;
    driverId;
    shiftId;
    latitude;
    longitude;
    batteryLevel;
    timestamp;
    createdAt;
    shift;
    driver;
};
exports.TrackingLog = TrackingLog;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], TrackingLog.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'driver_id', type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], TrackingLog.prototype, "driverId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'shift_id', type: 'varchar', length: 36, nullable: true }),
    __metadata("design:type", Object)
], TrackingLog.prototype, "shiftId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'latitude', type: 'decimal', precision: 10, scale: 7 }),
    __metadata("design:type", Number)
], TrackingLog.prototype, "latitude", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'longitude', type: 'decimal', precision: 10, scale: 7 }),
    __metadata("design:type", Number)
], TrackingLog.prototype, "longitude", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'battery_level', type: 'int', nullable: true }),
    __metadata("design:type", Object)
], TrackingLog.prototype, "batteryLevel", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'timestamp', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], TrackingLog.prototype, "timestamp", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], TrackingLog.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => shift_entity_1.Shift, { nullable: true, onDelete: 'SET NULL' }),
    (0, typeorm_1.JoinColumn)({ name: 'shift_id' }),
    __metadata("design:type", Object)
], TrackingLog.prototype, "shift", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => user_entity_1.User, { nullable: true, onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'driver_id', referencedColumnName: 'id' }),
    __metadata("design:type", Object)
], TrackingLog.prototype, "driver", void 0);
exports.TrackingLog = TrackingLog = __decorate([
    (0, typeorm_1.Entity)('tracking_logs')
], TrackingLog);
//# sourceMappingURL=tracking-log.entity.js.map