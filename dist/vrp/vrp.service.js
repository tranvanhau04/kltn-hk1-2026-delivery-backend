"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var VrpService_1;
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
    '#7C3AED',
    '#DC2626',
    '#0D9488',
    '#92400E',
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
const OSRM_BASE = 'https://router.project-osrm.org';
const OSRM_MAX_COORDS = 100;
const OSRM_TIMEOUT_MS = 4000;
async function fetchWithTimeout(url, timeoutMs = OSRM_TIMEOUT_MS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        return response;
    }
    catch (err) {
        clearTimeout(id);
        throw err;
    }
}
async function fetchOsrmTable(coords) {
    if (coords.length > OSRM_MAX_COORDS)
        return null;
    const coordStr = coords.map((c) => `${c[0]},${c[1]}`).join(';');
    const url = `${OSRM_BASE}/table/v1/driving/${coordStr}?annotations=distance,duration`;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await fetchWithTimeout(url);
            if (res.ok) {
                const data = (await res.json());
                if (data.code === 'Ok' && data.distances && data.durations) {
                    return { distances: data.distances, durations: data.durations };
                }
            }
        }
        catch {
            if (attempt === 1)
                await new Promise((r) => setTimeout(r, 400));
        }
    }
    return null;
}
async function fetchOsrmRoute(coords) {
    if (coords.length < 2)
        return null;
    const coordStr = coords.map((c) => `${c[0]},${c[1]}`).join(';');
    const url = `${OSRM_BASE}/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await fetchWithTimeout(url);
            if (res.ok) {
                const data = (await res.json());
                if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                    const route = data.routes[0];
                    let polyline = [];
                    if (route.geometry?.coordinates) {
                        polyline = route.geometry.coordinates.map((c) => [c[1], c[0]]);
                    }
                    return {
                        distance: route.distance / 1000,
                        duration: route.duration / 60,
                        polyline,
                    };
                }
            }
        }
        catch {
            if (attempt === 1)
                await new Promise((r) => setTimeout(r, 400));
        }
    }
    return null;
}
function buildCostMatrix(nodes, osrmMatrix) {
    return {
        distKm: (i, j) => {
            if (osrmMatrix?.distances?.[i]?.[j] !== undefined) {
                return osrmMatrix.distances[i][j] / 1000;
            }
            return haversine(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng) * 1.35;
        },
        durMin: (i, j) => {
            if (osrmMatrix?.durations?.[i]?.[j] !== undefined) {
                return osrmMatrix.durations[i][j] / 60;
            }
            const dist = haversine(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng) * 1.35;
            return (dist / 30) * 60;
        },
    };
}
function twoOptImprove(stopIndices, costMatrix, depotIdx) {
    if (stopIndices.length <= 2)
        return stopIndices;
    let tour = [depotIdx, ...stopIndices, depotIdx];
    let improved = true;
    let iterations = 0;
    const maxIterations = 200;
    while (improved && iterations < maxIterations) {
        improved = false;
        iterations++;
        for (let i = 1; i < tour.length - 2; i++) {
            for (let k = i + 1; k < tour.length - 1; k++) {
                const delta = -costMatrix.distKm(tour[i - 1], tour[i]) -
                    costMatrix.distKm(tour[k], tour[k + 1]) +
                    costMatrix.distKm(tour[i - 1], tour[k]) +
                    costMatrix.distKm(tour[i], tour[k + 1]);
                if (delta < -0.001) {
                    tour = [...tour.slice(0, i), ...tour.slice(i, k + 1).reverse(), ...tour.slice(k + 1)];
                    improved = true;
                }
            }
        }
    }
    return tour.slice(1, tour.length - 1);
}
const SERVICE_TIME_MIN = 8;
const DEPOT_DEPARTURE_MIN = 7 * 60;
function checkTimeWindowFeasibility(stopOrders, costMatrix, allNodeIndices, depotNodeIdx) {
    const arrivalTimes = [];
    let currentTime = DEPOT_DEPARTURE_MIN;
    let prevNodeIdx = depotNodeIdx;
    for (let i = 0; i < stopOrders.length; i++) {
        const nodeIdx = allNodeIndices[i + 1];
        const travelMin = costMatrix.durMin(prevNodeIdx, nodeIdx);
        const arrivalMin = currentTime + travelMin;
        arrivalTimes.push(arrivalMin);
        const order = stopOrders[i];
        if (order.timeWindowEnd !== undefined && arrivalMin > order.timeWindowEnd) {
            return { feasible: false, arrivalTimes };
        }
        const departureMin = Math.max(arrivalMin, order.timeWindowStart ?? 0) + SERVICE_TIME_MIN;
        currentTime = departureMin;
        prevNodeIdx = nodeIdx;
    }
    return { feasible: true, arrivalTimes };
}
const HEAVY_WEIGHT_THRESHOLD_KG = 15;
const HEAVY_VOLUME_THRESHOLD_M3 = 0.05;
const MAX_SHIFT_DISTANCE_KM = 3.5;
function isHeavyOrder(order) {
    return (Number(order.weightKg) >= HEAVY_WEIGHT_THRESHOLD_KG ||
        Number(order.volumeM3) >= HEAVY_VOLUME_THRESHOLD_M3);
}
function isVanDriver(driver) {
    return (Number(driver.maxWeightKg) >= 500 ||
        driver.vehicleType.toUpperCase().includes('VAN') ||
        driver.vehicleType.toUpperCase().includes('TRUCK'));
}
function updateClusterCentroid(cluster) {
    if (cluster.orders.length === 0)
        return;
    const sumLat = cluster.orders.reduce((s, o) => s + Number(o.latitude), 0);
    const sumLng = cluster.orders.reduce((s, o) => s + Number(o.longitude), 0);
    cluster.centroid = {
        lat: sumLat / cluster.orders.length,
        lng: sumLng / cluster.orders.length,
    };
}
function runBalancedKMeans(orders, k, depot) {
    if (orders.length === 0 || k <= 0)
        return [];
    if (k === 1)
        return [orders];
    if (orders.length <= k) {
        return orders.map((o) => [o]);
    }
    const targetStops = Math.ceil(orders.length / k);
    let firstIdx = 0;
    let maxDepotDist = -1;
    for (let i = 0; i < orders.length; i++) {
        const d = haversine(depot.lat, depot.lng, Number(orders[i].latitude), Number(orders[i].longitude));
        if (d > maxDepotDist) {
            maxDepotDist = d;
            firstIdx = i;
        }
    }
    const centroids = [
        { lat: Number(orders[firstIdx].latitude), lng: Number(orders[firstIdx].longitude) },
    ];
    while (centroids.length < k) {
        let bestIdx = -1;
        let maxMinDist = -1;
        for (let i = 0; i < orders.length; i++) {
            const oLat = Number(orders[i].latitude);
            const oLng = Number(orders[i].longitude);
            let minDist = Infinity;
            for (const c of centroids) {
                const d = haversine(c.lat, c.lng, oLat, oLng);
                if (d < minDist)
                    minDist = d;
            }
            if (minDist > maxMinDist) {
                maxMinDist = minDist;
                bestIdx = i;
            }
        }
        if (bestIdx >= 0) {
            centroids.push({
                lat: Number(orders[bestIdx].latitude),
                lng: Number(orders[bestIdx].longitude),
            });
        }
        else {
            centroids.push({
                lat: Number(orders[0].latitude),
                lng: Number(orders[0].longitude),
            });
        }
    }
    const assignments = new Array(orders.length).fill(0);
    const maxIterations = 25;
    for (let iter = 0; iter < maxIterations; iter++) {
        let changed = false;
        for (let i = 0; i < orders.length; i++) {
            const oLat = Number(orders[i].latitude);
            const oLng = Number(orders[i].longitude);
            let nearestC = 0;
            let nearestDist = Infinity;
            for (let c = 0; c < k; c++) {
                const d = haversine(centroids[c].lat, centroids[c].lng, oLat, oLng);
                if (d < nearestDist) {
                    nearestDist = d;
                    nearestC = c;
                }
            }
            if (assignments[i] !== nearestC) {
                assignments[i] = nearestC;
                changed = true;
            }
        }
        const counts = new Array(k).fill(0);
        const sums = Array.from({ length: k }, () => ({ lat: 0, lng: 0 }));
        for (let i = 0; i < orders.length; i++) {
            const c = assignments[i];
            counts[c]++;
            sums[c].lat += Number(orders[i].latitude);
            sums[c].lng += Number(orders[i].longitude);
        }
        for (let c = 0; c < k; c++) {
            if (counts[c] > 0) {
                centroids[c] = {
                    lat: sums[c].lat / counts[c],
                    lng: sums[c].lng / counts[c],
                };
            }
        }
        if (!changed)
            break;
    }
    const clusters = [];
    for (let c = 0; c < k; c++) {
        const clusterOrders = [];
        for (let i = 0; i < orders.length; i++) {
            if (assignments[i] === c) {
                clusterOrders.push(orders[i]);
            }
        }
        clusters.push({
            orders: clusterOrders,
            centroid: centroids[c],
        });
    }
    for (const cl of clusters) {
        updateClusterCentroid(cl);
    }
    const maxBalancingIters = orders.length * 5;
    let bIter = 0;
    const lockedClusterIndices = new Set();
    while (bIter < maxBalancingIters) {
        bIter++;
        const overloaded = clusters
            .map((c, idx) => ({ c, idx }))
            .filter(({ c, idx }) => c.orders.length > targetStops && !lockedClusterIndices.has(idx));
        if (overloaded.length === 0)
            break;
        const underloaded = clusters.filter((c) => c.orders.length < targetStops);
        if (underloaded.length === 0)
            break;
        overloaded.sort((a, b) => b.c.orders.length - a.c.orders.length);
        const { c: sourceCluster, idx: sourceIdx } = overloaded[0];
        const sortedCandidateOrders = [...sourceCluster.orders].sort((a, b) => {
            const distA = haversine(sourceCluster.centroid.lat, sourceCluster.centroid.lng, Number(a.latitude), Number(a.longitude));
            const distB = haversine(sourceCluster.centroid.lat, sourceCluster.centroid.lng, Number(b.latitude), Number(b.longitude));
            return distB - distA;
        });
        let shifted = false;
        for (const orderToMove of sortedCandidateOrders) {
            let targetCluster = null;
            let minTargetDist = Infinity;
            for (const uc of underloaded) {
                const d = haversine(uc.centroid.lat, uc.centroid.lng, Number(orderToMove.latitude), Number(orderToMove.longitude));
                if (d < minTargetDist) {
                    minTargetDist = d;
                    targetCluster = uc;
                }
            }
            if (targetCluster && minTargetDist <= MAX_SHIFT_DISTANCE_KM) {
                const removeIdx = sourceCluster.orders.findIndex((o) => o.id === orderToMove.id);
                if (removeIdx >= 0) {
                    sourceCluster.orders.splice(removeIdx, 1);
                    targetCluster.orders.push(orderToMove);
                    updateClusterCentroid(sourceCluster);
                    updateClusterCentroid(targetCluster);
                    shifted = true;
                    break;
                }
            }
        }
        if (!shifted) {
            lockedClusterIndices.add(sourceIdx);
        }
        if (!clusters.some((c, idx) => c.orders.length > targetStops && !lockedClusterIndices.has(idx))) {
            break;
        }
    }
    return clusters.map((c) => c.orders).filter((c) => c.length > 0);
}
function matchClustersToDrivers(clusters, drivers) {
    const assignments = [];
    const remainingDrivers = [...drivers];
    const sortedClusters = [...clusters].sort((a, b) => {
        if (b.length !== a.length)
            return b.length - a.length;
        const wA = a.reduce((s, o) => s + Number(o.weightKg), 0);
        const wB = b.reduce((s, o) => s + Number(o.weightKg), 0);
        return wB - wA;
    });
    for (const cluster of sortedClusters) {
        if (remainingDrivers.length === 0)
            break;
        const zoneCounts = new Map();
        for (const o of cluster) {
            if (o.zoneId) {
                zoneCounts.set(o.zoneId, (zoneCounts.get(o.zoneId) || 0) + 1);
            }
        }
        let dominantZone = null;
        let maxCount = 0;
        for (const [z, count] of zoneCounts.entries()) {
            if (count > maxCount) {
                maxCount = count;
                dominantZone = z;
            }
        }
        const clusterWeight = cluster.reduce((s, o) => s + Number(o.weightKg), 0);
        const clusterVolume = cluster.reduce((s, o) => s + Number(o.volumeM3), 0);
        let bestDriverIdx = -1;
        let bestScore = -Infinity;
        for (let di = 0; di < remainingDrivers.length; di++) {
            const d = remainingDrivers[di];
            const maxW = Number(d.maxWeightKg);
            const maxV = Number(d.maxVolumeM3);
            let score = 0;
            if (dominantZone && d.zoneIds && d.zoneIds.includes(dominantZone)) {
                score += 1000;
            }
            else if (!dominantZone || !d.zoneIds || d.zoneIds.length === 0) {
                score += 100;
            }
            if (clusterWeight <= maxW) {
                score += 500;
            }
            else {
                score -= (clusterWeight - maxW) * 10;
            }
            if (maxV <= 0 || clusterVolume <= maxV) {
                score += 200;
            }
            score += maxW * 0.01;
            if (score > bestScore) {
                bestScore = score;
                bestDriverIdx = di;
            }
        }
        if (bestDriverIdx >= 0) {
            const [matchedDriver] = remainingDrivers.splice(bestDriverIdx, 1);
            assignments.push({ driver: matchedDriver, orders: cluster });
        }
    }
    return assignments;
}
let VrpService = VrpService_1 = class VrpService {
    logger = new common_1.Logger(VrpService_1.name);
    prepareOptimizationPayload(orders, drivers, zoneId) {
        let clusteredOrders = [...orders];
        if (zoneId) {
            clusteredOrders = clusteredOrders.filter((o) => !o.zoneId || o.zoneId === zoneId);
        }
        else {
            clusteredOrders.sort((a, b) => (a.zoneId || '').localeCompare(b.zoneId || ''));
        }
        const availableDrivers = drivers.filter((d) => Number(d.maxWeightKg) > 0 && (Number(d.maxVolumeM3) >= 0 || isNaN(Number(d.maxVolumeM3))));
        return { clusteredOrders, availableDrivers };
    }
    async solve(depot, orders, drivers, zoneId) {
        const startTime = Date.now();
        const { clusteredOrders, availableDrivers } = this.prepareOptimizationPayload(orders, drivers, zoneId);
        if (clusteredOrders.length === 0) {
            return {
                routes: [],
                totalDistanceKm: 0,
                totalOrders: 0,
                assignedOrders: 0,
                unassignedOrders: [],
                optimizationTimeMs: Date.now() - startTime,
                depot,
                algorithmUsed: 'nearest-neighbor + 2-opt',
            };
        }
        if (availableDrivers.length === 0) {
            return {
                routes: [],
                totalDistanceKm: 0,
                totalOrders: clusteredOrders.length,
                assignedOrders: 0,
                unassignedOrders: clusteredOrders.map((o) => ({
                    orderId: o.id,
                    code: o.code,
                    reason: 'No available drivers matching capacity or zone constraints',
                })),
                optimizationTimeMs: Date.now() - startTime,
                depot,
                algorithmUsed: 'nearest-neighbor + 2-opt',
            };
        }
        const nodes = [
            { lat: Number(depot.latitude), lng: Number(depot.longitude) },
            ...clusteredOrders.map((o) => ({ lat: Number(o.latitude), lng: Number(o.longitude) })),
        ];
        const orderToNodeIdx = new Map();
        clusteredOrders.forEach((o, i) => orderToNodeIdx.set(o.id, i + 1));
        const osrmCoords = nodes.map((n) => [n.lng, n.lat]);
        this.logger.log(`VRP solve: ${clusteredOrders.length} orders, ${availableDrivers.length} drivers, ${nodes.length} nodes total`);
        let osrmMatrix = null;
        if (nodes.length <= OSRM_MAX_COORDS) {
            osrmMatrix = await fetchOsrmTable(osrmCoords);
            if (!osrmMatrix) {
                this.logger.warn('OSRM table unavailable – using Haversine fallback');
            }
        }
        else {
            this.logger.warn(`${nodes.length} nodes exceeds OSRM limit (${OSRM_MAX_COORDS}) – using Haversine`);
        }
        const costMatrix = buildCostMatrix(nodes, osrmMatrix);
        const unassignedOrders = [];
        const maxGlobalDriverWeight = Math.max(...availableDrivers.map((d) => Number(d.maxWeightKg)));
        const maxGlobalDriverVolume = Math.max(...availableDrivers.map((d) => Number(d.maxVolumeM3)));
        const feasibleOrders = [];
        for (const order of clusteredOrders) {
            if (Number(order.weightKg) > maxGlobalDriverWeight) {
                unassignedOrders.push({
                    orderId: order.id,
                    code: order.code,
                    reason: `Order weight (${order.weightKg} kg) exceeds max vehicle capacity (${maxGlobalDriverWeight} kg)`,
                });
            }
            else if (maxGlobalDriverVolume > 0 && Number(order.volumeM3) > maxGlobalDriverVolume) {
                unassignedOrders.push({
                    orderId: order.id,
                    code: order.code,
                    reason: `Order volume (${order.volumeM3} m3) exceeds max vehicle capacity (${maxGlobalDriverVolume} m3)`,
                });
            }
            else {
                feasibleOrders.push(order);
            }
        }
        if (feasibleOrders.length === 0) {
            return {
                routes: [],
                totalDistanceKm: 0,
                totalOrders: clusteredOrders.length,
                assignedOrders: 0,
                unassignedOrders,
                optimizationTimeMs: Date.now() - startTime,
                depot,
                algorithmUsed: 'nearest-neighbor + 2-opt',
            };
        }
        const heavyOrders = feasibleOrders.filter(isHeavyOrder);
        const lightOrders = feasibleOrders.filter((o) => !isHeavyOrder(o));
        const vanDrivers = availableDrivers.filter(isVanDriver);
        const motorbikeDrivers = availableDrivers.filter((d) => !isVanDriver(d));
        console.log('Heavy orders count:', heavyOrders.length, 'vs Light orders count:', lightOrders.length);
        console.log('Van drivers count:', vanDrivers.length, 'vs Motorbike drivers count:', motorbikeDrivers.length);
        const depotCoords = { lat: Number(depot.latitude), lng: Number(depot.longitude) };
        let vanAssignments = [];
        let motorbikeAssignments = [];
        if (lightOrders.length > 0) {
            if (motorbikeDrivers.length === 0) {
                if (vanDrivers.length > 0) {
                    this.logger.warn('No motorbikes available – falling back light orders to Vans');
                    const k = Math.min(vanDrivers.length, lightOrders.length);
                    const clusters = runBalancedKMeans(lightOrders, k, depotCoords);
                    motorbikeAssignments = matchClustersToDrivers(clusters, vanDrivers);
                }
                else {
                    for (const order of lightOrders) {
                        unassignedOrders.push({
                            orderId: order.id,
                            code: order.code,
                            reason: 'No Motorbike available for light order',
                        });
                    }
                }
            }
            else if (motorbikeDrivers.length === 1) {
                motorbikeAssignments = [{ driver: motorbikeDrivers[0], orders: lightOrders }];
            }
            else {
                const k = Math.min(motorbikeDrivers.length, lightOrders.length);
                const clusters = runBalancedKMeans(lightOrders, k, depotCoords);
                motorbikeAssignments = matchClustersToDrivers(clusters, motorbikeDrivers);
            }
        }
        if (heavyOrders.length > 0) {
            if (vanDrivers.length === 0) {
                for (const order of heavyOrders) {
                    unassignedOrders.push({
                        orderId: order.id,
                        code: order.code,
                        reason: 'No Van available for heavy/bulky order',
                    });
                }
            }
            else if (vanDrivers.length === 1) {
                vanAssignments = [{ driver: vanDrivers[0], orders: heavyOrders }];
            }
            else {
                const k = Math.min(vanDrivers.length, heavyOrders.length);
                const clusters = runBalancedKMeans(heavyOrders, k, depotCoords);
                vanAssignments = matchClustersToDrivers(clusters, vanDrivers);
            }
        }
        const generatedClustersCount = vanAssignments.length + motorbikeAssignments.length;
        console.log('Generated clusters count:', generatedClustersCount);
        const driverAssignments = [
            ...vanAssignments,
            ...motorbikeAssignments,
        ];
        for (let ai = 0; ai < driverAssignments.length; ai++) {
            const assignment = driverAssignments[ai];
            const driver = assignment.driver;
            const maxW = Number(driver.maxWeightKg);
            const maxV = Number(driver.maxVolumeM3);
            let currentW = assignment.orders.reduce((s, o) => s + Number(o.weightKg), 0);
            let currentV = assignment.orders.reduce((s, o) => s + Number(o.volumeM3), 0);
            if (currentW > maxW + 0.001 || (maxV > 0 && currentV > maxV + 0.0001)) {
                const ordersToKeep = [];
                const excessOrders = [];
                let runningW = 0;
                let runningV = 0;
                for (const order of assignment.orders) {
                    const w = Number(order.weightKg);
                    const v = Number(order.volumeM3);
                    if (runningW + w <= maxW + 0.001 &&
                        (maxV <= 0 || runningV + v <= maxV + 0.0001)) {
                        ordersToKeep.push(order);
                        runningW += w;
                        runningV += v;
                    }
                    else {
                        excessOrders.push(order);
                    }
                }
                assignment.orders = ordersToKeep;
                for (const excess of excessOrders) {
                    const ew = Number(excess.weightKg);
                    const ev = Number(excess.volumeM3);
                    let absorbed = false;
                    for (let aj = 0; aj < driverAssignments.length; aj++) {
                        if (ai === aj)
                            continue;
                        const other = driverAssignments[aj];
                        if (isVanDriver(other.driver) !== isVanDriver(driver))
                            continue;
                        const otherMaxW = Number(other.driver.maxWeightKg);
                        const otherMaxV = Number(other.driver.maxVolumeM3);
                        const otherW = other.orders.reduce((s, o) => s + Number(o.weightKg), 0);
                        const otherV = other.orders.reduce((s, o) => s + Number(o.volumeM3), 0);
                        if (otherW + ew <= otherMaxW + 0.001 &&
                            (otherMaxV <= 0 || otherV + ev <= otherMaxV + 0.0001)) {
                            other.orders.push(excess);
                            absorbed = true;
                            break;
                        }
                    }
                    if (!absorbed) {
                        unassignedOrders.push({
                            orderId: excess.id,
                            code: excess.code,
                            reason: 'All vehicles are at capacity',
                        });
                    }
                }
            }
        }
        const routes = [];
        for (const assignment of driverAssignments) {
            if (assignment.orders.length === 0)
                continue;
            const driver = assignment.driver;
            const remainingOrders = new Set(assignment.orders);
            const orderedStops = [];
            let currentNodeIdx = 0;
            while (remainingOrders.size > 0) {
                let nearestOrder = null;
                let nearestDist = Infinity;
                for (const order of remainingOrders) {
                    const nodeIdx = orderToNodeIdx.get(order.id);
                    const dist = costMatrix.distKm(currentNodeIdx, nodeIdx);
                    if (dist < nearestDist) {
                        nearestDist = dist;
                        nearestOrder = order;
                    }
                }
                if (!nearestOrder)
                    break;
                remainingOrders.delete(nearestOrder);
                orderedStops.push(nearestOrder);
                currentNodeIdx = orderToNodeIdx.get(nearestOrder.id);
            }
            const stopNodeIndices = orderedStops.map((o) => orderToNodeIdx.get(o.id));
            const improvedNodeIndices = twoOptImprove(stopNodeIndices, costMatrix, 0);
            const routeOrders = improvedNodeIndices.map((ni) => clusteredOrders[ni - 1]);
            const { arrivalTimes } = checkTimeWindowFeasibility(routeOrders, costMatrix, [0, ...improvedNodeIndices], 0);
            const routeOsrmCoords = [
                [Number(depot.longitude), Number(depot.latitude)],
                ...routeOrders.map((o) => [Number(o.longitude), Number(o.latitude)]),
                [Number(depot.longitude), Number(depot.latitude)],
            ];
            const osrmRoute = await fetchOsrmRoute(routeOsrmCoords);
            let totalDist = 0;
            let totalTime = 0;
            let polyline = [];
            if (osrmRoute) {
                totalDist = osrmRoute.distance;
                totalTime = osrmRoute.duration + routeOrders.length * SERVICE_TIME_MIN;
                polyline = osrmRoute.polyline;
            }
            else {
                const fallbackNodes = [
                    { lat: Number(depot.latitude), lng: Number(depot.longitude) },
                    ...routeOrders.map((o) => ({ lat: Number(o.latitude), lng: Number(o.longitude) })),
                    { lat: Number(depot.latitude), lng: Number(depot.longitude) },
                ];
                polyline = fallbackNodes.map((n) => [n.lat, n.lng]);
                for (let j = 0; j < fallbackNodes.length - 1; j++) {
                    totalDist +=
                        haversine(fallbackNodes[j].lat, fallbackNodes[j].lng, fallbackNodes[j + 1].lat, fallbackNodes[j + 1].lng) * 1.35;
                }
                totalTime = Math.round((totalDist / 25) * 60 + routeOrders.length * SERVICE_TIME_MIN);
            }
            const routeWeightKg = routeOrders.reduce((s, o) => s + Number(o.weightKg), 0);
            const routeVolumeM3 = routeOrders.reduce((s, o) => s + Number(o.volumeM3), 0);
            const maxWeight = Number(driver.maxWeightKg);
            if (routeWeightKg > maxWeight + 0.001) {
                throw new Error(`Vehicle capacity constraint violated: Route weight ${routeWeightKg}kg exceeds driver ${driver.userId} max weight ${maxWeight}kg`);
            }
            routes.push({
                driverId: driver.userId,
                driverName: driver.fullName,
                licensePlate: driver.licensePlate,
                vehicleType: driver.vehicleType,
                color: ROUTE_COLORS[routes.length % ROUTE_COLORS.length],
                totalDistanceKm: Math.round(totalDist * 10) / 10,
                totalEstimatedTimeMin: Math.round(totalTime),
                totalWeightKg: Math.round(routeWeightKg * 100) / 100,
                totalVolumeM3: Math.round(routeVolumeM3 * 1000) / 1000,
                polyline,
                stops: routeOrders.map((o, idx) => ({
                    sequenceNo: idx + 1,
                    orderId: o.id,
                    code: o.code,
                    receiverName: o.receiverName,
                    receiverPhone: o.receiverPhone,
                    deliveryAddress: o.deliveryAddress,
                    latitude: Number(o.latitude),
                    longitude: Number(o.longitude),
                    weightKg: Number(o.weightKg),
                    volumeM3: Number(o.volumeM3),
                    codAmount: Number(o.codAmount),
                    estimatedArrivalMin: arrivalTimes[idx] ?? null,
                })),
            });
        }
        console.log('Final route count being returned to frontend:', routes.length);
        const totalDistKm = routes.reduce((s, r) => s + r.totalDistanceKm, 0);
        const optimizationTimeMs = Date.now() - startTime;
        this.logger.log(`VRP done in ${optimizationTimeMs}ms | routes=${routes.length} | ` +
            `assigned=${clusteredOrders.length - unassignedOrders.length} | unassigned=${unassignedOrders.length}`);
        return {
            routes,
            totalDistanceKm: Math.round(totalDistKm * 10) / 10,
            totalOrders: clusteredOrders.length,
            assignedOrders: clusteredOrders.length - unassignedOrders.length,
            unassignedOrders,
            optimizationTimeMs,
            depot,
            algorithmUsed: 'nearest-neighbor + 2-opt',
        };
    }
};
exports.VrpService = VrpService;
exports.VrpService = VrpService = VrpService_1 = __decorate([
    (0, common_1.Injectable)()
], VrpService);
//# sourceMappingURL=vrp.service.js.map