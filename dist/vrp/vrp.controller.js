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
var VrpController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VrpController = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const vrp_service_1 = require("./vrp.service");
const routes_service_1 = require("../routes/routes.service");
const order_entity_1 = require("../entities/order.entity");
const driver_entity_1 = require("../entities/driver.entity");
const depot_entity_1 = require("../entities/depot.entity");
const user_entity_1 = require("../entities/user.entity");
const roles_decorator_1 = require("../auth/decorators/roles.decorator");
const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");
let VrpController = VrpController_1 = class VrpController {
    vrpService;
    routesService;
    orderRepo;
    driverRepo;
    depotRepo;
    userRepo;
    logger = new common_1.Logger(VrpController_1.name);
    constructor(vrpService, routesService, orderRepo, driverRepo, depotRepo, userRepo) {
        this.vrpService = vrpService;
        this.routesService = routesService;
        this.orderRepo = orderRepo;
        this.driverRepo = driverRepo;
        this.depotRepo = depotRepo;
        this.userRepo = userRepo;
    }
    async optimize(dto, user) {
        const depot = dto.depotId
            ? await this.depotRepo.findOneOrFail({ where: { id: dto.depotId } })
            : await this.depotRepo.findOne({ where: {} });
        if (!depot)
            throw new Error('No depot configured');
        const orders = await this.orderRepo.find({
            where: dto.orderIds?.length ? { id: (0, typeorm_2.In)(dto.orderIds) } : { status: order_entity_1.OrderStatus.NEW },
        });
        const driversRaw = await this.driverRepo.find(dto.driverIds?.length ? { where: { userId: (0, typeorm_2.In)(dto.driverIds) } } : {});
        const userIds = driversRaw.map((d) => d.userId);
        const users = userIds.length ? await this.userRepo.find({ where: { id: (0, typeorm_2.In)(userIds) } }) : [];
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
        this.logger.log(`Optimize request: dispatcher=${user?.sub}, orders=${orders.length}, drivers=${drivers.length}`);
        return this.vrpService.solve({
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
            timeWindowStart: o.timeWindowStart ?? undefined,
            timeWindowEnd: o.timeWindowEnd ?? undefined,
        })), drivers);
    }
    async confirm(dto, user) {
        this.logger.log(`Confirm request: dispatcher=${user?.sub}, routes=${dto.routes?.length ?? 0}`);
        return this.routesService.confirmRoutes(dto, user?.sub);
    }
    async listRoutes(query) {
        return this.routesService.findAll(query);
    }
    async getRoute(id) {
        return this.routesService.findById(id);
    }
};
exports.VrpController = VrpController;
__decorate([
    (0, common_1.Post)('optimize'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, roles_decorator_1.Roles)(user_entity_1.UserRole.DISPATCHER, user_entity_1.UserRole.ADMIN),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], VrpController.prototype, "optimize", null);
__decorate([
    (0, common_1.Post)('confirm'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, roles_decorator_1.Roles)(user_entity_1.UserRole.DISPATCHER, user_entity_1.UserRole.ADMIN),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], VrpController.prototype, "confirm", null);
__decorate([
    (0, common_1.Get)('routes'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], VrpController.prototype, "listRoutes", null);
__decorate([
    (0, common_1.Get)('routes/:id'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe({ version: '4', optional: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], VrpController.prototype, "getRoute", null);
exports.VrpController = VrpController = VrpController_1 = __decorate([
    (0, common_1.Controller)('vrp'),
    __param(2, (0, typeorm_1.InjectRepository)(order_entity_1.Order)),
    __param(3, (0, typeorm_1.InjectRepository)(driver_entity_1.Driver)),
    __param(4, (0, typeorm_1.InjectRepository)(depot_entity_1.Depot)),
    __param(5, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __metadata("design:paramtypes", [vrp_service_1.VrpService,
        routes_service_1.RoutesService,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], VrpController);
//# sourceMappingURL=vrp.controller.js.map