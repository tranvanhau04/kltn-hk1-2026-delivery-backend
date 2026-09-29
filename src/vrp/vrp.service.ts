import { Injectable, Logger } from '@nestjs/common';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VrpDepot {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface VrpOrder {
  id: string;
  code: string;
  receiverName: string;
  receiverPhone: string;
  deliveryAddress: string;
  latitude: number;
  longitude: number;
  weightKg: number;
  volumeM3: number;
  codAmount: number;
  /** Optional earliest delivery time as minutes-from-midnight (e.g. 8*60 = 480 for 08:00) */
  timeWindowStart?: number;
  /** Optional latest delivery time as minutes-from-midnight (e.g. 18*60 = 1080 for 18:00) */
  timeWindowEnd?: number;
}

export interface VrpDriver {
  userId: string;
  fullName: string;
  phone: string;
  licensePlate: string;
  vehicleType: string;
  maxWeightKg: number;
  maxVolumeM3: number;
}

export interface VrpStopResult {
  sequenceNo: number;
  orderId: string;
  code: string;
  receiverName: string;
  receiverPhone: string;
  deliveryAddress: string;
  latitude: number;
  longitude: number;
  weightKg: number;
  volumeM3: number;
  codAmount: number;
  /** Estimated arrival time in minutes from midnight (null if no time-window data) */
  estimatedArrivalMin: number | null;
}

export interface VrpRouteResult {
  driverId: string;
  driverName: string;
  licensePlate: string;
  vehicleType: string;
  color: string;
  stops: VrpStopResult[];
  totalDistanceKm: number;
  totalEstimatedTimeMin: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  polyline: [number, number][]; // [lat, lng][]
}

export interface VrpUnassignedOrder {
  orderId: string;
  code: string;
  reason: string;
}

export interface VrpSolutionResult {
  routes: VrpRouteResult[];
  totalDistanceKm: number;
  totalOrders: number;
  assignedOrders: number;
  unassignedOrders: VrpUnassignedOrder[];
  optimizationTimeMs: number;
  depot: VrpDepot;
  algorithmUsed: string;
}

// ─── Colors ──────────────────────────────────────────────────────────────────

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

// ─── Haversine distance (km) ──────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ─── OSRM Helpers ─────────────────────────────────────────────────────────────

const OSRM_BASE = 'https://router.project-osrm.org';
const OSRM_MAX_COORDS = 100;
const OSRM_TIMEOUT_MS = 4000;

async function fetchWithTimeout(url: string, timeoutMs = OSRM_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function fetchOsrmTable(
  coords: [number, number][],
): Promise<{ distances: number[][]; durations: number[][] } | null> {
  if (coords.length > OSRM_MAX_COORDS) return null;
  const coordStr = coords.map((c) => `${c[0]},${c[1]}`).join(';');
  const url = `${OSRM_BASE}/table/v1/driving/${coordStr}?annotations=distance,duration`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url);
      if (res.ok) {
        const data = (await res.json()) as {
          code?: string;
          distances?: number[][];
          durations?: number[][];
        };
        if (data.code === 'Ok' && data.distances && data.durations) {
          return { distances: data.distances, durations: data.durations };
        }
      }
    } catch {
      if (attempt === 1) await new Promise((r) => setTimeout(r, 400));
    }
  }
  return null;
}

async function fetchOsrmRoute(
  coords: [number, number][],
): Promise<{ distance: number; duration: number; polyline: [number, number][] } | null> {
  if (coords.length < 2) return null;
  const coordStr = coords.map((c) => `${c[0]},${c[1]}`).join(';');
  const url = `${OSRM_BASE}/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url);
      if (res.ok) {
        const data = (await res.json()) as {
          code?: string;
          routes?: {
            geometry?: { coordinates?: [number, number][] };
            distance: number;
            duration: number;
          }[];
        };
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          let polyline: [number, number][] = [];
          if (route.geometry?.coordinates) {
            polyline = route.geometry.coordinates.map(
              (c: [number, number]) => [c[1], c[0]] as [number, number],
            );
          }
          return {
            distance: route.distance / 1000,
            duration: route.duration / 60,
            polyline,
          };
        }
      }
    } catch {
      if (attempt === 1) await new Promise((r) => setTimeout(r, 400));
    }
  }
  return null;
}

// ─── Cost Matrix ──────────────────────────────────────────────────────────────

interface CostMatrix {
  distKm: (i: number, j: number) => number;
  durMin: (i: number, j: number) => number;
}

async function buildCostMatrix(
  nodes: Array<{ lat: number; lng: number }>,
  osrmMatrix: { distances: number[][]; durations: number[][] } | null,
): Promise<CostMatrix> {
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

// ─── 2-opt Local Search ───────────────────────────────────────────────────────

function twoOptImprove(
  stopIndices: number[],
  costMatrix: CostMatrix,
  depotIdx: number,
): number[] {
  if (stopIndices.length <= 2) return stopIndices;
  let tour = [depotIdx, ...stopIndices, depotIdx];
  let improved = true;
  let iterations = 0;
  const maxIterations = 200;
  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;
    for (let i = 1; i < tour.length - 2; i++) {
      for (let k = i + 1; k < tour.length - 1; k++) {
        const delta =
          -costMatrix.distKm(tour[i - 1], tour[i]) -
          costMatrix.distKm(tour[k], tour[k + 1]) +
          costMatrix.distKm(tour[i - 1], tour[k]) +
          costMatrix.distKm(tour[i], tour[k + 1]);
        if (delta < -0.001) {
          tour = [
            ...tour.slice(0, i),
            ...tour.slice(i, k + 1).reverse(),
            ...tour.slice(k + 1),
          ];
          improved = true;
        }
      }
    }
  }
  return tour.slice(1, tour.length - 1);
}

// ─── Time Window Check ────────────────────────────────────────────────────────

const SERVICE_TIME_MIN = 8;
const DEPOT_DEPARTURE_MIN = 7 * 60; // 07:00

function checkTimeWindowFeasibility(
  stopOrders: VrpOrder[],
  costMatrix: CostMatrix,
  allNodeIndices: number[],
  depotNodeIdx: number,
): { feasible: boolean; arrivalTimes: number[] } {
  const arrivalTimes: number[] = [];
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

// ─── VrpService ───────────────────────────────────────────────────────────────

@Injectable()
export class VrpService {
  private readonly logger = new Logger(VrpService.name);

  /**
   * Solves CVRP (weight + volume) with optional VRPTW (time windows).
   * Algorithm: Nearest-Neighbor greedy construction + 2-opt local search.
   * Uses OSRM for real road distances/durations; Haversine fallback when unavailable.
   */
  async solve(
    depot: VrpDepot,
    orders: VrpOrder[],
    drivers: VrpDriver[],
  ): Promise<VrpSolutionResult> {
    const startTime = Date.now();

    if (orders.length === 0) {
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

    const availableDrivers = drivers.filter((d) => Number(d.maxWeightKg) > 0);

    if (availableDrivers.length === 0) {
      return {
        routes: [],
        totalDistanceKm: 0,
        totalOrders: orders.length,
        assignedOrders: 0,
        unassignedOrders: orders.map((o) => ({
          orderId: o.id,
          code: o.code,
          reason: 'No available drivers',
        })),
        optimizationTimeMs: Date.now() - startTime,
        depot,
        algorithmUsed: 'nearest-neighbor + 2-opt',
      };
    }

    // Build node list: index 0 = depot, 1..N = orders
    const nodes: Array<{ lat: number; lng: number }> = [
      { lat: Number(depot.latitude), lng: Number(depot.longitude) },
      ...orders.map((o) => ({ lat: Number(o.latitude), lng: Number(o.longitude) })),
    ];

    // OSRM expects [lng, lat]
    const osrmCoords: [number, number][] = nodes.map((n) => [n.lng, n.lat]);

    this.logger.log(
      `VRP solve: ${orders.length} orders, ${availableDrivers.length} drivers, ${nodes.length} nodes total`,
    );

    let osrmMatrix: { distances: number[][]; durations: number[][] } | null = null;
    if (nodes.length <= OSRM_MAX_COORDS) {
      osrmMatrix = await fetchOsrmTable(osrmCoords);
      if (!osrmMatrix) {
        this.logger.warn('OSRM table unavailable – using Haversine fallback');
      }
    } else {
      this.logger.warn(`${nodes.length} nodes exceeds OSRM limit (${OSRM_MAX_COORDS}) – using Haversine`);
    }

    const costMatrix = await buildCostMatrix(nodes, osrmMatrix);
    const unassignedSet = new Set<number>(orders.map((_, i) => i));
    const routes: VrpRouteResult[] = [];

    // ── Phase 1: Nearest-Neighbor Construction per Driver ───────────────────

    for (let di = 0; di < availableDrivers.length && unassignedSet.size > 0; di++) {
      const driver = availableDrivers[di];
      const maxWeight = Number(driver.maxWeightKg);
      const maxVolume = Number(driver.maxVolumeM3);

      const assignedOrderIndices: number[] = [];
      let loadKg = 0;
      let loadM3 = 0;
      let currentNodeIdx = 0; // depot

      while (unassignedSet.size > 0) {
        let bestOi = -1;
        let bestDist = Infinity;

        for (const oi of unassignedSet) {
          const order = orders[oi];
          if (loadKg + Number(order.weightKg) > maxWeight) continue;
          if (maxVolume > 0 && loadM3 + Number(order.volumeM3) > maxVolume) continue;

          const nodeIdx = oi + 1;
          const dist = costMatrix.distKm(currentNodeIdx, nodeIdx);
          if (dist < bestDist) {
            bestDist = dist;
            bestOi = oi;
          }
        }

        if (bestOi === -1) break;

        unassignedSet.delete(bestOi);
        assignedOrderIndices.push(bestOi);
        loadKg += Number(orders[bestOi].weightKg);
        loadM3 += Number(orders[bestOi].volumeM3);
        currentNodeIdx = bestOi + 1;
      }

      if (assignedOrderIndices.length === 0) continue;

      // ── Phase 2: 2-opt Improvement ──────────────────────────────────────────

      const improvedNodeIndices = twoOptImprove(
        assignedOrderIndices.map((oi) => oi + 1),
        costMatrix,
        0,
      );
      const routeOrders = improvedNodeIndices.map((ni) => orders[ni - 1]);

      // ── Phase 3: Time Window Feasibility & Arrival Times ─────────────────────

      const { arrivalTimes } = checkTimeWindowFeasibility(
        routeOrders,
        costMatrix,
        [0, ...improvedNodeIndices],
        0,
      );

      // ── Phase 4: Fetch OSRM Route Geometry ─────────────────────────────────

      const routeOsrmCoords: [number, number][] = [
        [Number(depot.longitude), Number(depot.latitude)],
        ...routeOrders.map((o): [number, number] => [Number(o.longitude), Number(o.latitude)]),
        [Number(depot.longitude), Number(depot.latitude)],
      ];
      const osrmRoute = await fetchOsrmRoute(routeOsrmCoords);

      let totalDist = 0;
      let totalTime = 0;
      let polyline: [number, number][] = [];

      if (osrmRoute) {
        totalDist = osrmRoute.distance;
        totalTime = osrmRoute.duration + routeOrders.length * SERVICE_TIME_MIN;
        polyline = osrmRoute.polyline;
      } else {
        const fallbackNodes = [
          { lat: Number(depot.latitude), lng: Number(depot.longitude) },
          ...routeOrders.map((o) => ({ lat: Number(o.latitude), lng: Number(o.longitude) })),
          { lat: Number(depot.latitude), lng: Number(depot.longitude) },
        ];
        polyline = fallbackNodes.map((n): [number, number] => [n.lat, n.lng]);
        for (let i = 0; i < fallbackNodes.length - 1; i++) {
          totalDist +=
            haversine(
              fallbackNodes[i].lat, fallbackNodes[i].lng,
              fallbackNodes[i + 1].lat, fallbackNodes[i + 1].lng,
            ) * 1.35;
        }
        totalTime = Math.round((totalDist / 25) * 60 + routeOrders.length * SERVICE_TIME_MIN);
      }

      const routeWeightKg = routeOrders.reduce((s, o) => s + Number(o.weightKg), 0);
      const routeVolumeM3 = routeOrders.reduce((s, o) => s + Number(o.volumeM3), 0);

      routes.push({
        driverId: driver.userId,
        driverName: driver.fullName,
        licensePlate: driver.licensePlate,
        vehicleType: driver.vehicleType,
        color: ROUTE_COLORS[di % ROUTE_COLORS.length],
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

    // ── Collect Unassigned Orders ─────────────────────────────────────────────

    const unassignedOrders: VrpUnassignedOrder[] = [];
    if (unassignedSet.size > 0) {
      const maxDriverWeight = Math.max(...availableDrivers.map((d) => Number(d.maxWeightKg)));
      const maxDriverVolume = Math.max(...availableDrivers.map((d) => Number(d.maxVolumeM3)));
      for (const oi of unassignedSet) {
        const order = orders[oi];
        let reason = 'All vehicles are at capacity';
        if (Number(order.weightKg) > maxDriverWeight) {
          reason = `Order weight (${order.weightKg} kg) exceeds max vehicle capacity (${maxDriverWeight} kg)`;
        } else if (maxDriverVolume > 0 && Number(order.volumeM3) > maxDriverVolume) {
          reason = `Order volume (${order.volumeM3} m3) exceeds max vehicle capacity (${maxDriverVolume} m3)`;
        }
        unassignedOrders.push({ orderId: order.id, code: order.code, reason });
      }
    }

    const totalDistKm = routes.reduce((s, r) => s + r.totalDistanceKm, 0);
    const optimizationTimeMs = Date.now() - startTime;

    this.logger.log(
      `VRP done in ${optimizationTimeMs}ms | routes=${routes.length} | ` +
        `assigned=${orders.length - unassignedOrders.length} | unassigned=${unassignedOrders.length}`,
    );

    return {
      routes,
      totalDistanceKm: Math.round(totalDistKm * 10) / 10,
      totalOrders: orders.length,
      assignedOrders: orders.length - unassignedOrders.length,
      unassignedOrders,
      optimizationTimeMs,
      depot,
      algorithmUsed: 'nearest-neighbor + 2-opt',
    };
  }
}
