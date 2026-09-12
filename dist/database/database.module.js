"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const depot_entity_1 = require("../entities/depot.entity");
const order_entity_1 = require("../entities/order.entity");
const driver_entity_1 = require("../entities/driver.entity");
const route_entity_1 = require("../entities/route.entity");
const stop_entity_1 = require("../entities/stop.entity");
const tracking_log_entity_1 = require("../entities/tracking-log.entity");
const user_entity_1 = require("../entities/user.entity");
let DatabaseModule = class DatabaseModule {
};
exports.DatabaseModule = DatabaseModule;
exports.DatabaseModule = DatabaseModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forRoot({
                type: 'mysql',
                host: '127.0.0.1',
                port: 3308,
                username: 'root',
                password: 'sapassword',
                database: 'delivery_db',
                entities: [depot_entity_1.Depot, order_entity_1.Order, driver_entity_1.Driver, route_entity_1.Route, stop_entity_1.Stop, tracking_log_entity_1.TrackingLog, user_entity_1.User],
                synchronize: false,
                logging: false,
                charset: 'utf8mb4_unicode_ci',
                extra: {
                    charset: 'utf8mb4_unicode_ci',
                },
            }),
        ],
        exports: [typeorm_1.TypeOrmModule],
    })
], DatabaseModule);
//# sourceMappingURL=database.module.js.map