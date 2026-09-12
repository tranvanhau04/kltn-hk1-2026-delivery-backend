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
exports.Stop = void 0;
const typeorm_1 = require("typeorm");
const order_entity_1 = require("./order.entity");
let Stop = class Stop {
    id;
    routeId;
    orderId;
    sequenceNo;
    arrivedAt;
    status;
    order;
};
exports.Stop = Stop;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], Stop.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'route_id', type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], Stop.prototype, "routeId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'order_id', type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], Stop.prototype, "orderId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'sequence_no', type: 'int' }),
    __metadata("design:type", Number)
], Stop.prototype, "sequenceNo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'arrived_at', type: 'timestamp', nullable: true }),
    __metadata("design:type", Object)
], Stop.prototype, "arrivedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'status', type: 'varchar', length: 20, default: 'PENDING' }),
    __metadata("design:type", String)
], Stop.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => order_entity_1.Order, { eager: true }),
    (0, typeorm_1.JoinColumn)({ name: 'order_id' }),
    __metadata("design:type", order_entity_1.Order)
], Stop.prototype, "order", void 0);
exports.Stop = Stop = __decorate([
    (0, typeorm_1.Entity)('stops')
], Stop);
//# sourceMappingURL=stop.entity.js.map