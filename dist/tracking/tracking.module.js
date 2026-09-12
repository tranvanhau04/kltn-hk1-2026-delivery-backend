"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrackingModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const tracking_controller_1 = require("./tracking.controller");
const tracking_log_entity_1 = require("../entities/tracking-log.entity");
const driver_entity_1 = require("../entities/driver.entity");
const route_entity_1 = require("../entities/route.entity");
const stop_entity_1 = require("../entities/stop.entity");
const user_entity_1 = require("../entities/user.entity");
let TrackingModule = class TrackingModule {
};
exports.TrackingModule = TrackingModule;
exports.TrackingModule = TrackingModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([tracking_log_entity_1.TrackingLog, driver_entity_1.Driver, route_entity_1.Route, stop_entity_1.Stop, user_entity_1.User])],
        controllers: [tracking_controller_1.TrackingController],
    })
], TrackingModule);
//# sourceMappingURL=tracking.module.js.map