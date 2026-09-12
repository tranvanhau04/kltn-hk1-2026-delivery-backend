"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VrpService = void 0;
const common_1 = require("@nestjs/common");
const ROUTE_COLORS = [
    '#FA7070',
    '#6D28D9',
    '#1D4ED8',
    '#059669',
    '#D97706',
    '#DB2777',
    '#0891B2',
    '#65A30D',
];
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function toRad(deg) {
    return (deg * Math.PI) / 180;
}
async function fetchWithTimeout(url, options, timeout = 2500) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    }
    catch (err) {
        clearTimeout(id);
        throw err;
    }
}
async function fetchOsrmTableWithRetry(coords) {
    const coordStr = coords.map(c => `${c[0]},${c[1]}`).join(';');
    const url = `https://router.project-osrm.org/table/v1/driving/${coordStr}?annotations=distance,duration`;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await fetchWithTimeout(url, {}, 2500);
            if (res.ok) {
                const data = await res.json();
                if (data.code === 'Ok' && data.distances && data.durations) {
                    return { distances: data.distances, durations: data.durations };
                }
            }
        }
        catch (e) {
            if (attempt === 1) {
                await new Promise(r => setTimeout(r, 300));
            }
        }
    }
    return null;
}
async function fetchOsrmRouteWithRetry(coords) {
    const coordStr = coords.map(c => `${c[0]},${c[1]}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await fetchWithTimeout(url, {}, 2500);
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
                        distance: route.distance / 1000,
                        duration: route.duration / 60,
                        polyline
                    };
                }
            }
        }
        catch (e) {
            if (attempt === 1) {
                await new Promise(r => setTimeout(r, 300));
            }
        }
    }
    return null;
}
let VrpService = class VrpService {
    async solve(depot, orders, drivers) {
        const startTime = Date.now();
        const availableDrivers = drivers.filter((d) => d.maxWeightKg > 0);
        const allCoords = [
            [Number(depot.longitude), Number(depot.latitude)],
            ...orders.map(o => [Number(o.longitude), Number(o.latitude)])
        ];
        let osrmMatrix = null;
        if (allCoords.length <= 100) {
            osrmMatrix = await fetchOsrmTableWithRetry(allCoords);
        }
        const getDistance = (idx1, idx2, lat1, lng1, lat2, lng2) => {
            if (osrmMatrix && osrmMatrix.distances && osrmMatrix.distances[idx1] && osrmMatrix.distances[idx1][idx2] !== undefined) {
                return osrmMatrix.distances[idx1][idx2] / 1000;
            }
            return haversine(lat1, lng1, lat2, lng2) * 1.35;
        };
        const unassigned = [...orders];
        const unassignedIndices = Array.from({ length: orders.length }, (_, i) => i + 1);
        const routes = [];
        for (let di = 0; di < availableDrivers.length && unassigned.length > 0; di++) {
            const driver = availableDrivers[di];
            const routeStops = [];
            let loadKg = 0;
            let currentIdx = 0;
            let currentLat = depot.latitude;
            let currentLng = depot.longitude;
            while (unassigned.length > 0) {
                let bestLocalIdx = -1;
                let bestDist = Infinity;
                for (let i = 0; i < unassigned.length; i++) {
                    const o = unassigned[i];
                    const globalIdx = unassignedIndices[i];
                    if (loadKg + Number(o.weightKg) > Number(driver.maxWeightKg))
                        continue;
                    const d = getDistance(currentIdx, globalIdx, currentLat, currentLng, Number(o.latitude), Number(o.longitude));
                    if (d < bestDist) {
                        bestDist = d;
                        bestLocalIdx = i;
                    }
                }
                if (bestLocalIdx === -1)
                    break;
                const chosen = unassigned.splice(bestLocalIdx, 1)[0];
                const chosenGlobalIdx = unassignedIndices.splice(bestLocalIdx, 1)[0];
                routeStops.push(chosen);
                loadKg += Number(chosen.weightKg);
                currentLat = Number(chosen.latitude);
                currentLng = Number(chosen.longitude);
                currentIdx = chosenGlobalIdx;
            }
            if (routeStops.length === 0)
                continue;
            const routeCoords = [
                [Number(depot.longitude), Number(depot.latitude)],
                ...routeStops.map((s) => [Number(s.longitude), Number(s.latitude)]),
                [Number(depot.longitude), Number(depot.latitude)],
            ];
            const osrmRoute = await fetchOsrmRouteWithRetry(routeCoords);
            let totalDist = 0;
            let totalTime = 0;
            let polyline = [];
            if (osrmRoute) {
                totalDist = osrmRoute.distance;
                totalTime = osrmRoute.duration + (routeStops.length * 8);
                polyline = osrmRoute.polyline;
            }
            else {
                polyline = [
                    [Number(depot.latitude), Number(depot.longitude)],
                    ...routeStops.map((s) => [Number(s.latitude), Number(s.longitude)]),
                    [Number(depot.latitude), Number(depot.longitude)],
                ];
                for (let i = 0; i < polyline.length - 1; i++) {
                    totalDist += haversine(polyline[i][0], polyline[i][1], polyline[i + 1][0], polyline[i + 1][1]) * 1.35;
                }
                totalTime = Math.round((totalDist / 25) * 60 + routeStops.length * 8);
            }
            routes.push({
                driverId: driver.userId,
                driverName: driver.fullName,
                licensePlate: driver.licensePlate,
                vehicleType: driver.vehicleType,
                color: ROUTE_COLORS[di % ROUTE_COLORS.length],
                totalDistanceKm: Math.round(totalDist * 10) / 10,
                totalEstimatedTimeMin: Math.round(totalTime),
                totalWeightKg: Math.round(loadKg * 100) / 100,
                polyline,
                stops: routeStops.map((o, idx) => ({
                    sequenceNo: idx + 1,
                    orderId: o.id,
                    code: o.code,
                    receiverName: o.receiverName,
                    receiverPhone: o.receiverPhone,
                    deliveryAddress: o.deliveryAddress,
                    latitude: Number(o.latitude),
                    longitude: Number(o.longitude),
                    weightKg: Number(o.weightKg),
                    codAmount: Number(o.codAmount),
                })),
            });
        }
        const totalDist = routes.reduce((s, r) => s + r.totalDistanceKm, 0);
        const optimizationTimeMs = Date.now() - startTime;
        return {
            routes,
            totalDistanceKm: Math.round(totalDist * 10) / 10,
            totalOrders: orders.length,
            optimizationTimeMs,
            depot,
        };
    }
};
exports.VrpService = VrpService;
exports.VrpService = VrpService = __decorate([
    (0, common_1.Injectable)()
], VrpService);
//# sourceMappingURL=vrp.service.js.map