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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VrpController = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const vrp_service_1 = require("./vrp.service");
const order_entity_1 = require("../entities/order.entity");
const driver_entity_1 = require("../entities/driver.entity");
const depot_entity_1 = require("../entities/depot.entity");
const route_entity_1 = require("../entities/route.entity");
const stop_entity_1 = require("../entities/stop.entity");
const user_entity_1 = require("../entities/user.entity");
const uuid_1 = require("uuid");
let VrpController = class VrpController {
    vrpService;
    orderRepo;
    driverRepo;
    depotRepo;
    routeRepo;
    stopRepo;
    userRepo;
    constructor(vrpService, orderRepo, driverRepo, depotRepo, routeRepo, stopRepo, userRepo) {
        this.vrpService = vrpService;
        this.orderRepo = orderRepo;
        this.driverRepo = driverRepo;
        this.depotRepo = depotRepo;
        this.routeRepo = routeRepo;
        this.stopRepo = stopRepo;
        this.userRepo = userRepo;
    }
    async optimize(dto) {
        const depot = dto.depotId
            ? await this.depotRepo.findOneOrFail({ where: { id: dto.depotId } })
            : await this.depotRepo.findOne({ where: {} });
        if (!depot)
            throw new Error('No depot found');
        const orders = await this.orderRepo.find({
            where: dto.orderIds?.length
                ? { id: (0, typeorm_2.In)(dto.orderIds) }
                : { status: 'NEW' },
        });
        const driversRaw = await this.driverRepo.find(dto.driverIds?.length ? { where: { userId: (0, typeorm_2.In)(dto.driverIds) } } : {});
        const userIds = driversRaw.map((d) => d.userId);
        const users = userIds.length
            ? await this.userRepo.find({ where: { id: (0, typeorm_2.In)(userIds) } })
            : [];
        const userMap = new Map(users.map((u) => [u.id, u]));
        const drivers = driversRaw
            .filter((d) => d.currentShiftStatus !== 'OFFLINE')
            .map((d) => {
            const u = userMap.get(d.userId);
            return {
                userId: d.userId,
                fullName: u?.fullName ?? 'Unknown Driver',
                phone: u?.phone ?? '',
                licensePlate: d.licensePlate,
                vehicleType: d.vehicleType,
                maxWeightKg: Number(d.maxWeightKg),
                maxVolumeM3: Number(d.maxVolumeM3),
            };
        });
        return await this.vrpService.solve({
            id: depot.id,
            name: depot.name,
            latitude: Number(depot.latitude),
            longitude: Number(depot.longitude),
        }, orders.map((o) => ({
            id: o.id,
            code: o.code,
            receiverName: o.receiverName,
            receiverPhone: o.receiverPhone,
            deliveryAddress: o.deliveryAddress,
            latitude: Number(o.latitude),
            longitude: Number(o.longitude),
            weightKg: Number(o.weightKg),
            volumeM3: Number(o.volumeM3),
            codAmount: Number(o.codAmount),
        })), drivers);
    }
    async confirm(dto) {
        const today = new Date().toISOString().split('T')[0];
        const routeIds = [];
        for (const r of dto.routes) {
            const routeId = (0, uuid_1.v4)();
            routeIds.push(routeId);
            const polylineJson = JSON.stringify(r.polyline);
            const route = this.routeRepo.create({
                id: routeId,
                depotId: r.depotId,
                driverId: r.driverId,
                routeDate: today,
                totalDistanceKm: r.totalDistanceKm,
                totalEstimatedTimeMin: r.totalEstimatedTimeMin,
                status: 'PLANNED',
                polyline: polylineJson,
            });
            await this.routeRepo.save(route);
            for (const s of r.stops) {
                const stop = this.stopRepo.create({
                    id: (0, uuid_1.v4)(),
                    routeId,
                    orderId: s.orderId,
                    sequenceNo: s.sequenceNo,
                    status: 'PENDING',
                    arrivedAt: null,
                });
                await this.stopRepo.save(stop);
                await this.orderRepo.update(s.orderId, { status: 'ASSIGNED' });
            }
        }
        return { message: 'Routes confirmed and dispatched', routeIds };
    }
};
exports.VrpController = VrpController;
__decorate([
    (0, common_1.Post)('optimize'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], VrpController.prototype, "optimize", null);
__decorate([
    (0, common_1.Post)('confirm'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], VrpController.prototype, "confirm", null);
exports.VrpController = VrpController = __decorate([
    (0, common_1.Controller)('vrp'),
    __param(1, (0, typeorm_1.InjectRepository)(order_entity_1.Order)),
    __param(2, (0, typeorm_1.InjectRepository)(driver_entity_1.Driver)),
    __param(3, (0, typeorm_1.InjectRepository)(depot_entity_1.Depot)),
    __param(4, (0, typeorm_1.InjectRepository)(route_entity_1.Route)),
    __param(5, (0, typeorm_1.InjectRepository)(stop_entity_1.Stop)),
    __param(6, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __metadata("design:paramtypes", [vrp_service_1.VrpService,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], VrpController);
//# sourceMappingURL=vrp.controller.js.map