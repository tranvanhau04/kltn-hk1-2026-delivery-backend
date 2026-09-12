"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VrpModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const vrp_controller_1 = require("./vrp.controller");
const vrp_service_1 = require("./vrp.service");
const graph_service_1 = require("./graph.service");
const max_flow_service_1 = require("./max-flow.service");
const order_entity_1 = require("../entities/order.entity");
const driver_entity_1 = require("../entities/driver.entity");
const depot_entity_1 = require("../entities/depot.entity");
const route_entity_1 = require("../entities/route.entity");
const stop_entity_1 = require("../entities/stop.entity");
const user_entity_1 = require("../entities/user.entity");
let VrpModule = class VrpModule {
};
exports.VrpModule = VrpModule;
exports.VrpModule = VrpModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([order_entity_1.Order, driver_entity_1.Driver, depot_entity_1.Depot, route_entity_1.Route, stop_entity_1.Stop, user_entity_1.User])],
        controllers: [vrp_controller_1.VrpController],
        providers: [vrp_service_1.VrpService, graph_service_1.GraphService, max_flow_service_1.MaxFlowService],
    })
], VrpModule);
//# sourceMappingURL=vrp.module.js.map