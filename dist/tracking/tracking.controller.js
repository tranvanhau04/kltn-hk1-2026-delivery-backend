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
exports.TrackingController = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const tracking_log_entity_1 = require("../entities/tracking-log.entity");
const driver_entity_1 = require("../entities/driver.entity");
const route_entity_1 = require("../entities/route.entity");
const stop_entity_1 = require("../entities/stop.entity");
const user_entity_1 = require("../entities/user.entity");
const uuid_1 = require("uuid");
let TrackingController = class TrackingController {
    logRepo;
    driverRepo;
    routeRepo;
    stopRepo;
    userRepo;
    constructor(logRepo, driverRepo, routeRepo, stopRepo, userRepo) {
        this.logRepo = logRepo;
        this.driverRepo = driverRepo;
        this.routeRepo = routeRepo;
        this.stopRepo = stopRepo;
        this.userRepo = userRepo;
    }
    async liveTracking() {
        const drivers = await this.driverRepo.find();
        const activeDrivers = drivers.filter((d) => d.currentShiftStatus !== 'OFFLINE');
        const result = await Promise.all(activeDrivers.map(async (driver) => {
            const user = await this.userRepo.findOne({ where: { id: driver.userId } });
            const latestLog = await this.logRepo.findOne({
                where: { driverId: driver.userId },
                order: { timestamp: 'DESC' },
            });
            const activeRoute = await this.routeRepo.findOne({
                where: [
                    { driverId: driver.userId, status: 'IN_PROGRESS' },
                    { driverId: driver.userId, status: 'PLANNED' },
                ],
                order: { routeDate: 'DESC', createdAt: 'DESC' },
            });
            let polyline = [];
            if (activeRoute?.polyline) {
                try {
                    polyline = JSON.parse(activeRoute.polyline);
                }
                catch {
                    polyline = [];
                }
            }
            const hasRealGps = latestLog &&
                latestLog.latitude != null &&
                latestLog.longitude != null &&
                Number(latestLog.latitude) !== 0 &&
                Number(latestLog.longitude) !== 0;
            const currentLat = hasRealGps ? Number(latestLog.latitude) : null;
            const currentLng = hasRealGps ? Number(latestLog.longitude) : null;
            const positionUnknown = !hasRealGps;
            return {
                driverId: driver.userId,
                fullName: user?.fullName ?? 'Unknown',
                phone: user?.phone ?? '',
                licensePlate: driver.licensePlate,
                vehicleType: driver.vehicleType,
                currentShiftStatus: driver.currentShiftStatus,
                currentLat,
                currentLng,
                positionUnknown,
                lastUpdated: latestLog?.timestamp ?? null,
                activeRoute: activeRoute
                    ? {
                        routeId: activeRoute.id,
                        totalDistanceKm: Number(activeRoute.totalDistanceKm),
                        totalEstimatedTimeMin: Number(activeRoute.totalEstimatedTimeMin),
                        status: activeRoute.status,
                        polyline,
                    }
                    : null,
            };
        }));
        return result;
    }
    async postLocation(dto) {
        if (!dto.driverId || dto.lat == null || dto.lng == null) {
            throw new common_1.HttpException('driverId, lat and lng are required', common_1.HttpStatus.BAD_REQUEST);
        }
        const log = this.logRepo.create({
            id: (0, uuid_1.v4)(),
            driverId: dto.driverId,
            shiftId: null,
            latitude: dto.lat,
            longitude: dto.lng,
        });
        await this.logRepo.save(log);
        return { success: true, timestamp: log.timestamp };
    }
    async getDriverRoute(driverId) {
        const driver = await this.driverRepo.findOne({ where: { userId: driverId } });
        if (!driver) {
            return {
                success: false,
                message: 'Driver not found',
                route: null,
                stops: [],
            };
        }
        const today = new Date().toISOString().split('T')[0];
        const route = await this.routeRepo.findOne({
            where: [
                { driverId, status: 'IN_PROGRESS' },
                { driverId, status: 'PLANNED' },
            ],
            order: { routeDate: 'DESC', createdAt: 'DESC' },
        });
        if (!route) {
            return {
                success: false,
                message: 'No active route assigned for today. Please contact your dispatcher.',
                route: null,
                stops: [],
            };
        }
        const stops = await this.stopRepo.find({
            where: { routeId: route.id },
            order: { sequenceNo: 'ASC' },
        });
        let polyline = [];
        if (route.polyline) {
            try {
                polyline = JSON.parse(route.polyline);
            }
            catch {
                polyline = [];
            }
        }
        return {
            success: true,
            route: {
                id: route.id,
                driverId: route.driverId,
                routeDate: route.routeDate,
                totalDistanceKm: Number(route.totalDistanceKm),
                totalEstimatedTimeMin: Number(route.totalEstimatedTimeMin),
                status: route.status,
                polyline,
            },
            stops: stops.map((s) => ({
                id: s.id,
                routeId: s.routeId,
                orderId: s.orderId,
                sequenceNo: s.sequenceNo,
                status: s.status,
                arrivedAt: s.arrivedAt,
                order: s.order
                    ? {
                        id: s.order.id,
                        code: s.order.code,
                        receiverName: s.order.receiverName,
                        receiverPhone: s.order.receiverPhone,
                        deliveryAddress: s.order.deliveryAddress,
                        lat: Number(s.order.latitude),
                        lng: Number(s.order.longitude),
                        codAmount: Number(s.order.codAmount),
                        status: s.order.status,
                    }
                    : null,
            })),
        };
    }
    async endDriverShift(driverId, body) {
        const driver = await this.driverRepo.findOne({ where: { userId: driverId } });
        if (!driver) {
            throw new common_1.HttpException('Driver not found', common_1.HttpStatus.NOT_FOUND);
        }
        driver.currentShiftStatus = 'OFFLINE';
        await this.driverRepo.save(driver);
        return { success: true };
    }
    async startDriverShift(driverId) {
        const driver = await this.driverRepo.findOne({ where: { userId: driverId } });
        if (!driver) {
            throw new common_1.HttpException('Driver not found', common_1.HttpStatus.NOT_FOUND);
        }
        driver.currentShiftStatus = 'ONLINE_READY';
        await this.driverRepo.save(driver);
        return { success: true };
    }
};
exports.TrackingController = TrackingController;
__decorate([
    (0, common_1.Get)('tracking/live'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], TrackingController.prototype, "liveTracking", null);
__decorate([
    (0, common_1.Post)('driver/location'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TrackingController.prototype, "postLocation", null);
__decorate([
    (0, common_1.Get)('driver/:driverId/route'),
    __param(0, (0, common_1.Param)('driverId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], TrackingController.prototype, "getDriverRoute", null);
__decorate([
    (0, common_1.Post)('driver/:driverId/shift/end'),
    __param(0, (0, common_1.Param)('driverId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], TrackingController.prototype, "endDriverShift", null);
__decorate([
    (0, common_1.Post)('driver/:driverId/shift/start'),
    __param(0, (0, common_1.Param)('driverId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], TrackingController.prototype, "startDriverShift", null);
exports.TrackingController = TrackingController = __decorate([
    (0, common_1.Controller)(),
    __param(0, (0, typeorm_1.InjectRepository)(tracking_log_entity_1.TrackingLog)),
    __param(1, (0, typeorm_1.InjectRepository)(driver_entity_1.Driver)),
    __param(2, (0, typeorm_1.InjectRepository)(route_entity_1.Route)),
    __param(3, (0, typeorm_1.InjectRepository)(stop_entity_1.Stop)),
    __param(4, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], TrackingController);
//# sourceMappingURL=tracking.controller.js.map