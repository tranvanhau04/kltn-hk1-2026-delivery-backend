import { Injectable } from '@nestjs/common';

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
  codAmount: number;
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
  polyline: [number, number][]; // [lat, lng][]
}

export interface VrpSolutionResult {
  routes: VrpRouteResult[];
  totalDistanceKm: number;
  totalOrders: number;
  optimizationTimeMs: number;
  depot: VrpDepot;
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
];

// ─── Haversine distance (km) ──────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius km
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

async function fetchWithTimeout(url: string, options: any, timeout: number = 2500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...(options as RequestInit), signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function fetchOsrmTableWithRetry(
  coords: [number, number][],
): Promise<{ distances: number[][]; durations: number[][] } | null> {
  const coordStr = coords.map((c) => `${c[0]},${c[1]}`).join(';');
  const url = `https://router.project-osrm.org/table/v1/driving/${coordStr}?annotations=distance,duration`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {}, 2500);
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
      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  return null;
}

async function fetchOsrmRouteWithRetry(
  coords: [number, number][],
): Promise<{ distance: number; duration: number; polyline: [number, number][] } | null> {
  const coordStr = coords.map((c) => `${c[0]},${c[1]}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {}, 2500);
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
          // route.distance is in meters, route.duration is in seconds
          const geometry = route.geometry;
          let polyline: [number, number][] = [];
          if (geometry && geometry.coordinates) {
            polyline = geometry.coordinates.map(
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
      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  return null;
}

// ─── CVRP Solver (Nearest Neighbor Heuristic) ────────────────────────────────

@Injectable()
export class VrpService {
  /**
   * Solves the Capacitated Vehicle Routing Problem using a nearest-neighbor
   * greedy heuristic. Respects vehicle weight capacity.
   */
  async solve(
    depot: VrpDepot,
    orders: VrpOrder[],
    drivers: VrpDriver[],
  ): Promise<VrpSolutionResult> {
    const startTime = Date.now();

    const availableDrivers = drivers.filter((d) => d.maxWeightKg > 0);

    // Build coords array: Depot at index 0, then unassigned orders
    const allCoords: [number, number][] = [
      [Number(depot.longitude), Number(depot.latitude)],
      ...orders.map((o) => [Number(o.longitude), Number(o.latitude)] as [number, number]),
    ];

    let osrmMatrix: { distances: number[][]; durations: number[][] } | null = null;

    // OSRM table has a limit, typically 100 coordinates.
    if (allCoords.length <= 100) {
      osrmMatrix = await fetchOsrmTableWithRetry(allCoords);
    }

    const getDistance = (
      idx1: number,
      idx2: number,
      lat1: number,
      lng1: number,
      lat2: number,
      lng2: number,
    ) => {
      if (
        osrmMatrix &&
        osrmMatrix.distances &&
        osrmMatrix.distances[idx1] &&
        osrmMatrix.distances[idx1][idx2] !== undefined
      ) {
        return osrmMatrix.distances[idx1][idx2] / 1000; // convert meters to km
      }
      return haversine(lat1, lng1, lat2, lng2) * 1.35;
    };

    const unassigned = [...orders];
    const unassignedIndices = Array.from({ length: orders.length }, (_, i) => i + 1); // 1-based indices (0 is depot)

    const routes: VrpRouteResult[] = [];

    for (let di = 0; di < availableDrivers.length && unassigned.length > 0; di++) {
      const driver = availableDrivers[di];
      const routeStops: VrpOrder[] = [];
      let loadKg = 0;

      // Start from depot
      let currentIdx = 0;
      let currentLat = depot.latitude;
      let currentLng = depot.longitude;

      // Greedily pick nearest unassigned order within capacity
      while (unassigned.length > 0) {
        let bestLocalIdx = -1;
        let bestDist = Infinity;

        for (let i = 0; i < unassigned.length; i++) {
          const o = unassigned[i];
          const globalIdx = unassignedIndices[i];
          if (loadKg + Number(o.weightKg) > Number(driver.maxWeightKg)) continue;

          const d = getDistance(
            currentIdx,
            globalIdx,
            currentLat,
            currentLng,
            Number(o.latitude),
            Number(o.longitude),
          );

          if (d < bestDist) {
            bestDist = d;
            bestLocalIdx = i;
          }
        }

        if (bestLocalIdx === -1) break; // No feasible order found for this driver

        const chosen = unassigned.splice(bestLocalIdx, 1)[0];
        const chosenGlobalIdx = unassignedIndices.splice(bestLocalIdx, 1)[0];

        routeStops.push(chosen);
        loadKg += Number(chosen.weightKg);
        currentLat = Number(chosen.latitude);
        currentLng = Number(chosen.longitude);
        currentIdx = chosenGlobalIdx;
      }

      if (routeStops.length === 0) continue;

      // Now fetch actual route geometry and distance/duration from OSRM
      const routeCoords: [number, number][] = [
        [Number(depot.longitude), Number(depot.latitude)],
        ...routeStops.map((s): [number, number] => [Number(s.longitude), Number(s.latitude)]),
        [Number(depot.longitude), Number(depot.latitude)],
      ];

      const osrmRoute = await fetchOsrmRouteWithRetry(routeCoords);

      let totalDist = 0;
      let totalTime = 0;
      let polyline: [number, number][] = [];

      if (osrmRoute) {
        totalDist = osrmRoute.distance;
        totalTime = osrmRoute.duration + routeStops.length * 8; // Add 8 mins per stop service time
        polyline = osrmRoute.polyline;
      } else {
        // Fallback
        polyline = [
          [Number(depot.latitude), Number(depot.longitude)],
          ...routeStops.map((s): [number, number] => [Number(s.latitude), Number(s.longitude)]),
          [Number(depot.latitude), Number(depot.longitude)],
        ];

        for (let i = 0; i < polyline.length - 1; i++) {
          totalDist +=
            haversine(polyline[i][0], polyline[i][1], polyline[i + 1][0], polyline[i + 1][1]) *
            1.35;
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
}
