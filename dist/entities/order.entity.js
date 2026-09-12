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
exports.Order = void 0;
const typeorm_1 = require("typeorm");
let Order = class Order {
    id;
    code;
    dispatcherId;
    zoneId;
    receiverName;
    receiverPhone;
    deliveryAddress;
    latitude;
    longitude;
    weightKg;
    volumeM3;
    codAmount;
    status;
    createdAt;
    updatedAt;
};
exports.Order = Order;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], Order.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'code', type: 'varchar', length: 50 }),
    __metadata("design:type", String)
], Order.prototype, "code", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'dispatcher_id', type: 'varchar', length: 36, nullable: true }),
    __metadata("design:type", Object)
], Order.prototype, "dispatcherId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'zone_id', type: 'varchar', length: 36, nullable: true }),
    __metadata("design:type", Object)
], Order.prototype, "zoneId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'receiver_name', type: 'varchar', length: 100 }),
    __metadata("design:type", String)
], Order.prototype, "receiverName", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'receiver_phone', type: 'varchar', length: 20 }),
    __metadata("design:type", String)
], Order.prototype, "receiverPhone", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'delivery_address', type: 'text' }),
    __metadata("design:type", String)
], Order.prototype, "deliveryAddress", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'latitude', type: 'decimal', precision: 10, scale: 7 }),
    __metadata("design:type", Number)
], Order.prototype, "latitude", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'longitude', type: 'decimal', precision: 10, scale: 7 }),
    __metadata("design:type", Number)
], Order.prototype, "longitude", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'weight_kg', type: 'decimal', precision: 8, scale: 2 }),
    __metadata("design:type", Number)
], Order.prototype, "weightKg", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'volume_m3', type: 'decimal', precision: 8, scale: 3 }),
    __metadata("design:type", Number)
], Order.prototype, "volumeM3", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'cod_amount', type: 'decimal', precision: 12, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Order.prototype, "codAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'status', type: 'varchar', length: 20, default: 'NEW' }),
    __metadata("design:type", String)
], Order.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], Order.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], Order.prototype, "updatedAt", void 0);
exports.Order = Order = __decorate([
    (0, typeorm_1.Entity)('orders')
], Order);
//# sourceMappingURL=order.entity.js.map