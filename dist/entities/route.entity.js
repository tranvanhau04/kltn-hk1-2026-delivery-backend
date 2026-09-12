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
exports.Route = void 0;
const typeorm_1 = require("typeorm");
const stop_entity_1 = require("./stop.entity");
let Route = class Route {
    id;
    depotId;
    driverId;
    shiftId;
    dispatcherId;
    routeDate;
    totalDistanceKm;
    totalEstimatedTimeMin;
    status;
    polyline;
    createdAt;
    stops;
};
exports.Route = Route;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], Route.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'depot_id', type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], Route.prototype, "depotId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'driver_id', type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], Route.prototype, "driverId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'shift_id', type: 'varchar', length: 36, nullable: true }),
    __metadata("design:type", Object)
], Route.prototype, "shiftId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'dispatcher_id', type: 'varchar', length: 36, nullable: true }),
    __metadata("design:type", Object)
], Route.prototype, "dispatcherId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'route_date', type: 'date' }),
    __metadata("design:type", String)
], Route.prototype, "routeDate", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'total_distance_km', type: 'decimal', precision: 8, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Route.prototype, "totalDistanceKm", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'total_estimated_time_min', type: 'decimal', precision: 8, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Route.prototype, "totalEstimatedTimeMin", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'status', type: 'varchar', length: 20, default: 'PLANNED' }),
    __metadata("design:type", String)
], Route.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'polyline', type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Route.prototype, "polyline", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], Route.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => stop_entity_1.Stop, (stop) => stop.routeId),
    __metadata("design:type", Array)
], Route.prototype, "stops", void 0);
exports.Route = Route = __decorate([
    (0, typeorm_1.Entity)('routes')
], Route);
//# sourceMappingURL=route.entity.js.map