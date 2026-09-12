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
exports.GraphService = void 0;
const common_1 = require("@nestjs/common");
let GraphService = class GraphService {
    nodes = new Map();
    adjList = new Map();
    constructor() {
    }
    haversine(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    async findShortestPath(startLat, startLng, endLat, endLng) {
        try {
            const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 2500);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(id);
            if (res.ok) {
                const data = await res.json();
                if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                    const route = data.routes[0];
                    const geometry = route.geometry;
                    let polyline = [];
                    if (geometry && geometry.coordinates) {
                        polyline = geometry.coordinates.map((c) => [c[1], c[0]]);
                    }
                    return {
                        distanceKm: route.distance / 1000,
                        durationMin: route.duration / 60,
                        polyline
                    };
                }
            }
        }
        catch (e) {
        }
        const distanceKm = this.haversine(startLat, startLng, endLat, endLng);
        const durationMin = (distanceKm / 30) * 60;
        const polyline = [
            [startLat, startLng],
            [endLat, endLng]
        ];
        return { distanceKm, durationMin, polyline };
    }
};
exports.GraphService = GraphService;
exports.GraphService = GraphService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], GraphService);
//# sourceMappingURL=graph.service.js.map