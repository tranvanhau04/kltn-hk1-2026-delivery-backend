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
  /** Optional zone / district id for geographical clustering */
  zoneId?: string | null;
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
  /** Designated working zones for hard geofencing */
  zoneIds?: string[];
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
  /** Estimated fuel consumed in liters */
  estimatedFuelLiters?: number;
  /** Estimated fuel cost in VND */
  estimatedFuelCostVnd?: number;
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
  /** Total estimated fuel consumed across all routes (Liters) */
  totalFuelLiters?: number;
  /** Total estimated fuel cost across all routes (VND) */
  totalFuelCostVnd?: number;
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

function buildCostMatrix(
  nodes: Array<{ lat: number; lng: number }>,
  osrmMatrix: { distances: number[][]; durations: number[][] } | null,
): CostMatrix {
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

function twoOptImprove(stopIndices: number[], costMatrix: CostMatrix, depotIdx: number): number[] {
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
          tour = [...tour.slice(0, i), ...tour.slice(i, k + 1).reverse(), ...tour.slice(k + 1)];
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

// ─── Zone & Fleet Configuration Constants ─────────────────────────────────────

export const VRP_CONFIG = {
  /** Maximum stops/nodes per vehicle route */
  MAX_STOPS_PER_VEHICLE: 50,
  /** Maximum shift/route time in minutes (Strict 8-hour shift ceiling = 480 min) */
  MAX_ROUTE_TIME_MIN: 480,
  /** Maximum route travel distance in km (200 km) */
  MAX_ROUTE_DISTANCE_KM: 200,
  /** Drop penalty for unassigned nodes (100,000) - incentivizes packing vehicles up to capacity */
  UNASSIGNED_DROP_PENALTY: 100_000,
  /** Maximum shift distance between cluster centroids during balancing (km) */
  MAX_SHIFT_DISTANCE_KM: 3.5,
  /** Service time per stop in minutes */
  SERVICE_TIME_MIN: 6,
  /** Heavy weight threshold for strict vehicle segregation (Orders > 20kg require Van/Truck) */
  HEAVY_WEIGHT_THRESHOLD_KG: 20,
  /** Heavy volume threshold for strict vehicle segregation (Orders > 0.35m3 require Van/Truck) */
  HEAVY_VOLUME_THRESHOLD_M3: 0.35,
  /** Fuel consumption rate for motorbikes (liters / 100km) */
  MOTORBIKE_FUEL_RATE_L_PER_100KM: 2.3,
  /** Fuel consumption rate for vans/trucks (liters / 100km) */
  VAN_FUEL_RATE_L_PER_100KM: 10.5,
  /** Gasoline price RON 95 (VND / liter) */
  GASOLINE_PRICE_VND: 24500,
  /** Diesel price DO 0.05S (VND / liter) */
  DIESEL_PRICE_VND: 21500,
};

function isHeavyOrder(order: VrpOrder): boolean {
  return (
    Number(order.weightKg) > VRP_CONFIG.HEAVY_WEIGHT_THRESHOLD_KG ||
    Number(order.volumeM3) > VRP_CONFIG.HEAVY_VOLUME_THRESHOLD_M3
  );
}

function isVanDriver(driver: VrpDriver): boolean {
  return (
    Number(driver.maxWeightKg) >= 500 ||
    driver.vehicleType.toUpperCase().includes('VAN') ||
    driver.vehicleType.toUpperCase().includes('TRUCK')
  );
}

function getDriverFuelWeight(driver: VrpDriver): number {
  return isVanDriver(driver) ? 2.8 : 1.0;
}

// ─── Polar Coordinates & Radial Sector Helpers ───────────────────────────────

function polarAngle(
  centerLat: number,
  centerLng: number,
  targetLat: number,
  targetLng: number,
): number {
  const dLat = targetLat - centerLat;
  const dLng = (targetLng - centerLng) * Math.cos((centerLat * Math.PI) / 180);
  let angle = Math.atan2(dLat, dLng);
  if (angle < 0) angle += 2 * Math.PI;
  return angle;
}

function angularDiff(angle1: number, angle2: number): number {
  let diff = Math.abs(angle1 - angle2);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff;
}

function angularWeightedDist(
  orderLat: number,
  orderLng: number,
  centroidLat: number,
  centroidLng: number,
  depotLat: number,
  depotLng: number,
): number {
  const geoDist = haversine(centroidLat, centroidLng, orderLat, orderLng);
  const angleOrder = polarAngle(depotLat, depotLng, orderLat, orderLng);
  const angleCentroid = polarAngle(depotLat, depotLng, centroidLat, centroidLng);
  const diffAngle = angularDiff(angleOrder, angleCentroid);
  // Sector penalty: if order is in a different radial corridor, penalize distance by up to 120%
  return geoDist * (1.0 + 1.2 * (diffAngle / Math.PI));
}

// ─── Balanced K-Means ────────────────────────────────────────────────────────

interface ClusterState {
  orders: VrpOrder[];
  centroid: { lat: number; lng: number };
}

function updateClusterCentroid(cluster: ClusterState): void {
  if (cluster.orders.length === 0) return;
  const sumLat = cluster.orders.reduce((s, o) => s + Number(o.latitude), 0);
  const sumLng = cluster.orders.reduce((s, o) => s + Number(o.longitude), 0);
  cluster.centroid = {
    lat: sumLat / cluster.orders.length,
    lng: sumLng / cluster.orders.length,
  };
}

function runBalancedKMeans(
  orders: VrpOrder[],
  k: number,
  depot: { lat: number; lng: number },
): VrpOrder[][] {
  if (orders.length === 0 || k <= 0) return [];
  if (k === 1) return [orders];
  if (orders.length <= k) {
    return orders.map((o) => [o]);
  }

  const targetStops = Math.min(Math.ceil(orders.length / k), VRP_CONFIG.MAX_STOPS_PER_VEHICLE);

  // 1. Centroid initialization using K-Means++ (furthest point from depot + previous centroids)
  let firstIdx = 0;
  let maxDepotDist = -1;
  for (let i = 0; i < orders.length; i++) {
    const d = haversine(
      depot.lat,
      depot.lng,
      Number(orders[i].latitude),
      Number(orders[i].longitude),
    );
    if (d > maxDepotDist) {
      maxDepotDist = d;
      firstIdx = i;
    }
  }

  const centroids: Array<{ lat: number; lng: number }> = [
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
        if (d < minDist) minDist = d;
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
    } else {
      centroids.push({
        lat: Number(orders[0].latitude),
        lng: Number(orders[0].longitude),
      });
    }
  }

  // 2. Standard K-Means iterations
  const assignments = new Array<number>(orders.length).fill(0);
  const maxIterations = 25;

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Assign to nearest centroid
    for (let i = 0; i < orders.length; i++) {
      const oLat = Number(orders[i].latitude);
      const oLng = Number(orders[i].longitude);
      let nearestC = 0;
      let nearestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = angularWeightedDist(
          oLat,
          oLng,
          centroids[c].lat,
          centroids[c].lng,
          depot.lat,
          depot.lng,
        );
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

    // Recompute centroids
    const counts = new Array<number>(k).fill(0);
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

    if (!changed) break;
  }

  // Assemble cluster objects
  const clusters: ClusterState[] = [];
  for (let c = 0; c < k; c++) {
    const clusterOrders: VrpOrder[] = [];
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

  // 3. Balancing post-process loop:
  // Identify "Overloaded" clusters (size > targetStops) and "Underloaded" clusters (size < targetStops).
  // While there are overloaded clusters:
  // - Find candidate order furthest from centroid within the overloaded cluster.
  // - Reassign this order to the NEAREST underloaded cluster, PROVIDED distance <= MAX_SHIFT_DISTANCE_KM.
  // - If distance > MAX_SHIFT_DISTANCE_KM, DO NOT shift. Accept geographic imbalance to avoid cross-city detours.
  const maxBalancingIters = orders.length * 5;
  let bIter = 0;
  const lockedClusterIndices = new Set<number>();

  while (bIter < maxBalancingIters) {
    bIter++;

    const overloaded = clusters
      .map((c, idx) => ({ c, idx }))
      .filter(({ c, idx }) => c.orders.length > targetStops && !lockedClusterIndices.has(idx));

    if (overloaded.length === 0) break;

    const underloaded = clusters.filter((c) => c.orders.length < targetStops);
    if (underloaded.length === 0) break;

    // Pick the most overloaded cluster
    overloaded.sort((a, b) => b.c.orders.length - a.c.orders.length);
    const { c: sourceCluster, idx: sourceIdx } = overloaded[0];

    // Sort sourceCluster orders by distance to source centroid descending (furthest first)
    const sortedCandidateOrders = [...sourceCluster.orders].sort((a, b) => {
      const distA = haversine(
        sourceCluster.centroid.lat,
        sourceCluster.centroid.lng,
        Number(a.latitude),
        Number(a.longitude),
      );
      const distB = haversine(
        sourceCluster.centroid.lat,
        sourceCluster.centroid.lng,
        Number(b.latitude),
        Number(b.longitude),
      );
      return distB - distA;
    });

    let shifted = false;

    for (const orderToMove of sortedCandidateOrders) {
      // Find nearest underloaded cluster to this order
      let targetCluster: ClusterState | null = null;
      let minTargetDist = Infinity;

      for (const uc of underloaded) {
        const d = angularWeightedDist(
          Number(orderToMove.latitude),
          Number(orderToMove.longitude),
          uc.centroid.lat,
          uc.centroid.lng,
          depot.lat,
          depot.lng,
        );
        if (d < minTargetDist) {
          minTargetDist = d;
          targetCluster = uc;
        }
      }

      // Check Geographic Constraint:
      // If distance > VRP_CONFIG.MAX_SHIFT_DISTANCE_KM, DO NOT shift it. Accept the imbalance.
      if (targetCluster && minTargetDist <= VRP_CONFIG.MAX_SHIFT_DISTANCE_KM) {
        const removeIdx = sourceCluster.orders.findIndex((o) => o.id === orderToMove.id);
        if (removeIdx >= 0) {
          sourceCluster.orders.splice(removeIdx, 1);
          targetCluster.orders.push(orderToMove);

          updateClusterCentroid(sourceCluster);
          updateClusterCentroid(targetCluster);

          shifted = true;
          break; // successfully shifted one order in this step
        }
      }
    }

    if (!shifted) {
      // No order in this cluster can be shifted within VRP_CONFIG.MAX_SHIFT_DISTANCE_KM.
      // Accept geographic imbalance and stop balancing this cluster.
      lockedClusterIndices.add(sourceIdx);
    }

    if (
      !clusters.some((c, idx) => c.orders.length > targetStops && !lockedClusterIndices.has(idx))
    ) {
      break;
    }
  }

  return clusters.map((c) => c.orders).filter((c) => c.length > 0);
}

interface DriverAssignment {
  driver: VrpDriver;
  orders: VrpOrder[];
}

function matchClustersToDrivers(clusters: VrpOrder[][], drivers: VrpDriver[]): DriverAssignment[] {
  const assignments: DriverAssignment[] = [];
  const remainingDrivers = [...drivers];

  // Sort clusters by size descending, then total weight descending
  const sortedClusters = [...clusters].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const wA = a.reduce((s, o) => s + Number(o.weightKg), 0);
    const wB = b.reduce((s, o) => s + Number(o.weightKg), 0);
    return wB - wA;
  });

  for (const cluster of sortedClusters) {
    if (remainingDrivers.length === 0) break;

    // Dominant zone of the cluster
    const zoneCounts = new Map<string, number>();
    for (const o of cluster) {
      if (o.zoneId) {
        zoneCounts.set(o.zoneId, (zoneCounts.get(o.zoneId) || 0) + 1);
      }
    }
    let dominantZone: string | null = null;
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

      // Zone match preference
      if (dominantZone && d.zoneIds && d.zoneIds.includes(dominantZone)) {
        score += 1000;
      } else if (!dominantZone || !d.zoneIds || d.zoneIds.length === 0) {
        score += 100;
      }

      // Capacity preference
      if (clusterWeight <= maxW) {
        score += 500;
      } else {
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

// ─── Inter-Route Local Search (Relocate & Swap) ──────────────────────────────

interface MutableRoute {
  driver: VrpDriver;
  nodeIndices: number[]; // sequence of node indices (1..N) without depot
  totalWeight: number;
  totalVolume: number;
}

function optimizeInterRoute(
  routes: MutableRoute[],
  costMatrix: CostMatrix,
  nodeToOrder: Map<number, VrpOrder>,
): void {
  if (routes.length <= 1) return;

  let improved = true;
  let iter = 0;
  const maxIters = 60;

  while (improved && iter < maxIters) {
    improved = false;
    iter++;

    // ── 1. RELOCATE (1-0 Shift): Move a node from route A to route B ──
    for (let a = 0; a < routes.length; a++) {
      const rA = routes[a];
      if (rA.nodeIndices.length === 0) continue;
      const fuelWeightA = getDriverFuelWeight(rA.driver);

      for (let i = 0; i < rA.nodeIndices.length; i++) {
        const nodeToMove = rA.nodeIndices[i];
        const orderToMove = nodeToOrder.get(nodeToMove)!;
        const wMove = Number(orderToMove.weightKg);
        const vMove = Number(orderToMove.volumeM3);
        const isHeavy = isHeavyOrder(orderToMove);

        // Distance saved in route A by removing nodeToMove
        const prevA = i === 0 ? 0 : rA.nodeIndices[i - 1];
        const nextA = i === rA.nodeIndices.length - 1 ? 0 : rA.nodeIndices[i + 1];
        const distSavedA =
          costMatrix.distKm(prevA, nodeToMove) +
          costMatrix.distKm(nodeToMove, nextA) -
          costMatrix.distKm(prevA, nextA);

        let bestB = -1;
        let bestInsertPos = -1;
        let bestFuelSaving = 0.05; // Fuel-adjusted km saving threshold

        for (let b = 0; b < routes.length; b++) {
          if (a === b) continue;
          const rB = routes[b];
          if (isHeavy && !isVanDriver(rB.driver)) continue;
          if (rB.nodeIndices.length >= VRP_CONFIG.MAX_STOPS_PER_VEHICLE) continue;
          if (rB.totalWeight + wMove > Number(rB.driver.maxWeightKg) + 0.001) continue;
          if (
            Number(rB.driver.maxVolumeM3) > 0 &&
            rB.totalVolume + vMove > Number(rB.driver.maxVolumeM3) + 0.0001
          ) {
            continue;
          }

          const fuelWeightB = getDriverFuelWeight(rB.driver);

          // Find cheapest insertion position in rB
          for (let j = 0; j <= rB.nodeIndices.length; j++) {
            const prevB = j === 0 ? 0 : rB.nodeIndices[j - 1];
            const nextB = j === rB.nodeIndices.length ? 0 : rB.nodeIndices[j];
            const distAddedB =
              costMatrix.distKm(prevB, nodeToMove) +
              costMatrix.distKm(nodeToMove, nextB) -
              costMatrix.distKm(prevB, nextB);

            const fuelDiff = distAddedB * fuelWeightB - distSavedA * fuelWeightA;
            if (-fuelDiff > bestFuelSaving) {
              // Verify time windows for the candidate route
              const testNodes = [
                ...rB.nodeIndices.slice(0, j),
                nodeToMove,
                ...rB.nodeIndices.slice(j),
              ];
              const testOrders = testNodes.map((ni) => nodeToOrder.get(ni)!);
              const twCheck = checkTimeWindowFeasibility(
                testOrders,
                costMatrix,
                [0, ...testNodes],
                0,
              );
              if (twCheck.feasible) {
                bestFuelSaving = -fuelDiff;
                bestB = b;
                bestInsertPos = j;
              }
            }
          }
        }

        if (bestB >= 0 && bestInsertPos >= 0) {
          // Perform relocate
          rA.nodeIndices.splice(i, 1);
          rA.totalWeight -= wMove;
          rA.totalVolume -= vMove;

          const rB = routes[bestB];
          rB.nodeIndices.splice(bestInsertPos, 0, nodeToMove);
          rB.totalWeight += wMove;
          rB.totalVolume += vMove;

          // Re-optimize 2-opt on both modified routes
          rA.nodeIndices = twoOptImprove(rA.nodeIndices, costMatrix, 0);
          rB.nodeIndices = twoOptImprove(rB.nodeIndices, costMatrix, 0);

          improved = true;
          break;
        }
      }
      if (improved) break;
    }

    if (improved) continue;

    // ── 2. SWAP (1-1 Exchange): Swap one node in route A with one in route B ──
    for (let a = 0; a < routes.length; a++) {
      const rA = routes[a];
      if (rA.nodeIndices.length === 0) continue;
      const fuelWeightA = getDriverFuelWeight(rA.driver);

      for (let b = a + 1; b < routes.length; b++) {
        const rB = routes[b];
        if (rB.nodeIndices.length === 0) continue;
        const fuelWeightB = getDriverFuelWeight(rB.driver);

        for (let i = 0; i < rA.nodeIndices.length; i++) {
          const nodeA = rA.nodeIndices[i];
          const orderA = nodeToOrder.get(nodeA)!;
          const wA = Number(orderA.weightKg);
          const vA = Number(orderA.volumeM3);
          const isHeavyA = isHeavyOrder(orderA);

          if (isHeavyA && !isVanDriver(rB.driver)) continue;

          for (let j = 0; j < rB.nodeIndices.length; j++) {
            const nodeB = rB.nodeIndices[j];
            const orderB = nodeToOrder.get(nodeB)!;
            const wB = Number(orderB.weightKg);
            const vB = Number(orderB.volumeM3);
            const isHeavyB = isHeavyOrder(orderB);

            if (isHeavyB && !isVanDriver(rA.driver)) continue;

            const newWeightA = rA.totalWeight - wA + wB;
            const newWeightB = rB.totalWeight - wB + wA;
            if (newWeightA > Number(rA.driver.maxWeightKg) + 0.001) continue;
            if (newWeightB > Number(rB.driver.maxWeightKg) + 0.001) continue;

            const newVolA = rA.totalVolume - vA + vB;
            const newVolB = rB.totalVolume - vB + vA;
            if (
              Number(rA.driver.maxVolumeM3) > 0 &&
              newVolA > Number(rA.driver.maxVolumeM3) + 0.0001
            ) {
              continue;
            }
            if (
              Number(rB.driver.maxVolumeM3) > 0 &&
              newVolB > Number(rB.driver.maxVolumeM3) + 0.0001
            ) {
              continue;
            }

            // Delta in route A
            const prevA = i === 0 ? 0 : rA.nodeIndices[i - 1];
            const nextA = i === rA.nodeIndices.length - 1 ? 0 : rA.nodeIndices[i + 1];
            const deltaDistA =
              costMatrix.distKm(prevA, nodeB) +
              costMatrix.distKm(nodeB, nextA) -
              (costMatrix.distKm(prevA, nodeA) + costMatrix.distKm(nodeA, nextA));

            // Delta in route B
            const prevB = j === 0 ? 0 : rB.nodeIndices[j - 1];
            const nextB = j === rB.nodeIndices.length - 1 ? 0 : rB.nodeIndices[j + 1];
            const deltaDistB =
              costMatrix.distKm(prevB, nodeA) +
              costMatrix.distKm(nodeA, nextB) -
              (costMatrix.distKm(prevB, nodeB) + costMatrix.distKm(nodeB, nextB));

            const fuelDiff = deltaDistA * fuelWeightA + deltaDistB * fuelWeightB;
            if (fuelDiff < -0.05) {
              // Time window feasibility
              const testNodesA = [...rA.nodeIndices];
              testNodesA[i] = nodeB;
              const testOrdersA = testNodesA.map((ni) => nodeToOrder.get(ni)!);
              const twA = checkTimeWindowFeasibility(testOrdersA, costMatrix, [0, ...testNodesA], 0);
              if (!twA.feasible) continue;

              const testNodesB = [...rB.nodeIndices];
              testNodesB[j] = nodeA;
              const testOrdersB = testNodesB.map((ni) => nodeToOrder.get(ni)!);
              const twB = checkTimeWindowFeasibility(testOrdersB, costMatrix, [0, ...testNodesB], 0);
              if (!twB.feasible) continue;

              // Perform swap
              rA.nodeIndices[i] = nodeB;
              rA.totalWeight = newWeightA;
              rA.totalVolume = newVolA;

              rB.nodeIndices[j] = nodeA;
              rB.totalWeight = newWeightB;
              rB.totalVolume = newVolB;

              rA.nodeIndices = twoOptImprove(rA.nodeIndices, costMatrix, 0);
              rB.nodeIndices = twoOptImprove(rB.nodeIndices, costMatrix, 0);

              improved = true;
              break;
            }
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }
}

// ─── VrpService ───────────────────────────────────────────────────────────────

@Injectable()
export class VrpService {
  private readonly logger = new Logger(VrpService.name);

  /**
   * Prepares and validates input data for the VRP solver (OR-Tools / CVRP Engine).
   * Strictly enforces:
   * 1. Geographical Clustering: Groups or filters orders by specific zone/district.
   * 2. Vehicle Capacity Constraints: Validates driver maximum payload (Weight/Volume).
   * 3. Driver Availability: Ensures drivers have valid availability status and positive capacity.
   */
  prepareOptimizationPayload(
    orders: VrpOrder[],
    drivers: VrpDriver[],
    zoneId?: string,
  ): { clusteredOrders: VrpOrder[]; availableDrivers: VrpDriver[] } {
    let clusteredOrders = [...orders];
    if (zoneId) {
      clusteredOrders = clusteredOrders.filter((o) => !o.zoneId || o.zoneId === zoneId);
    } else {
      // Group orders by zone to preserve geographical clustering
      clusteredOrders.sort((a, b) => (a.zoneId || '').localeCompare(b.zoneId || ''));
    }

    // Vehicle Capacity Constraints: Filter available drivers with positive max payload
    const availableDrivers = drivers.filter(
      (d) =>
        Number(d.maxWeightKg) > 0 && (Number(d.maxVolumeM3) >= 0 || isNaN(Number(d.maxVolumeM3))),
    );

    return { clusteredOrders, availableDrivers };
  }

  /**
   * Solves CVRP (weight + volume) with optional VRPTW (time windows).
   * Algorithm: Nearest-Neighbor greedy construction + 2-opt local search.
   * Uses OSRM for real road distances/durations; Haversine fallback when unavailable.
   */
  async solve(
    depot: VrpDepot,
    orders: VrpOrder[],
    drivers: VrpDriver[],
    zoneId?: string,
  ): Promise<VrpSolutionResult> {
    const startTime = Date.now();

    const { clusteredOrders, availableDrivers } = this.prepareOptimizationPayload(
      orders,
      drivers,
      zoneId,
    );

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

    // Build node list: index 0 = depot, 1..N = orders
    const nodes: Array<{ lat: number; lng: number }> = [
      { lat: Number(depot.latitude), lng: Number(depot.longitude) },
      ...clusteredOrders.map((o) => ({ lat: Number(o.latitude), lng: Number(o.longitude) })),
    ];
    const orderToNodeIdx = new Map<string, number>();
    clusteredOrders.forEach((o, i) => orderToNodeIdx.set(o.id, i + 1));

    // OSRM expects [lng, lat]
    const osrmCoords: [number, number][] = nodes.map((n) => [n.lng, n.lat]);

    this.logger.log(
      `VRP solve: ${clusteredOrders.length} orders, ${availableDrivers.length} drivers, ${nodes.length} nodes total`,
    );

    let osrmMatrix: { distances: number[][]; durations: number[][] } | null = null;
    if (nodes.length <= OSRM_MAX_COORDS) {
      osrmMatrix = await fetchOsrmTable(osrmCoords);
      if (!osrmMatrix) {
        this.logger.warn('OSRM table unavailable – using Haversine fallback');
      }
    } else {
      this.logger.warn(
        `${nodes.length} nodes exceeds OSRM limit (${OSRM_MAX_COORDS}) – using Haversine`,
      );
    }

    const costMatrix = buildCostMatrix(nodes, osrmMatrix);
    const unassignedOrders: VrpUnassignedOrder[] = [];

    // Filter individual orders that exceed global maximum driver capacity
    const maxGlobalDriverWeight = Math.max(...availableDrivers.map((d) => Number(d.maxWeightKg)));
    const maxGlobalDriverVolume = Math.max(...availableDrivers.map((d) => Number(d.maxVolumeM3)));

    const feasibleOrders: VrpOrder[] = [];
    for (const order of clusteredOrders) {
      if (Number(order.weightKg) > maxGlobalDriverWeight) {
        unassignedOrders.push({
          orderId: order.id,
          code: order.code,
          reason: `Order weight (${order.weightKg} kg) exceeds max vehicle capacity (${maxGlobalDriverWeight} kg)`,
        });
      } else if (maxGlobalDriverVolume > 0 && Number(order.volumeM3) > maxGlobalDriverVolume) {
        unassignedOrders.push({
          orderId: order.id,
          code: order.code,
          reason: `Order volume (${order.volumeM3} m3) exceeds max vehicle capacity (${maxGlobalDriverVolume} m3)`,
        });
      } else {
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

    // ── STEP 1: Fleet Segregation & Initial Clustering ────────────────────────
    // Heavy/Bulky orders (> 30kg or > 0.15m3) strictly require Van/Truck
    // Standard orders (<= 30kg and <= 0.15m3) can be delivered by Motorbikes or Vans/Trucks
    const heavyOrders = feasibleOrders.filter(isHeavyOrder);
    const standardOrders = feasibleOrders.filter((o) => !isHeavyOrder(o));

    const vanDrivers = availableDrivers.filter(isVanDriver);
    const motorbikeDrivers = availableDrivers.filter((d) => !isVanDriver(d));

    console.log(
      'Heavy orders count:',
      heavyOrders.length,
      'vs Standard orders count:',
      standardOrders.length,
    );
    console.log(
      'Van drivers count:',
      vanDrivers.length,
      'vs Motorbike drivers count:',
      motorbikeDrivers.length,
    );

    const depotCoords = { lat: Number(depot.latitude), lng: Number(depot.longitude) };
    let vanAssignments: DriverAssignment[] = [];
    let motorbikeAssignments: DriverAssignment[] = [];

    // Assign strictly heavy orders to Vans/Trucks
    if (heavyOrders.length > 0) {
      if (vanDrivers.length === 0) {
        // If no vans exist, heavy orders cannot be fulfilled by motorbikes
        for (const ho of heavyOrders) {
          unassignedOrders.push({
            orderId: ho.id,
            code: ho.code,
            reason: `Order exceeds motorbike capacity (${ho.weightKg} kg, ${ho.volumeM3} m3) – requires Van/Truck vehicle`,
          });
        }
      } else if (vanDrivers.length === 1) {
        vanAssignments = [{ driver: vanDrivers[0], orders: heavyOrders }];
      } else {
        const k = Math.min(vanDrivers.length, heavyOrders.length);
        const clusters = runBalancedKMeans(heavyOrders, k, depotCoords);
        vanAssignments = matchClustersToDrivers(clusters, vanDrivers);
      }
    }

    // Assign standard orders to motorbikes (or vans if no motorbikes)
    if (standardOrders.length > 0) {
      if (motorbikeDrivers.length === 0) {
        if (vanDrivers.length > 0) {
          this.logger.warn('No motorbikes available – standard orders assigned to Vans');
          // Standard orders will be packed into vans during Step 3C
        }
      } else if (motorbikeDrivers.length === 1) {
        motorbikeAssignments = [{ driver: motorbikeDrivers[0], orders: standardOrders }];
      } else {
        const k = Math.min(motorbikeDrivers.length, standardOrders.length);
        const clusters = runBalancedKMeans(standardOrders, k, depotCoords);
        motorbikeAssignments = matchClustersToDrivers(clusters, motorbikeDrivers);
      }
    }

    // Ensure all drivers are present in driverAssignments even if initial cluster had 0 orders
    const driverAssignments: DriverAssignment[] = availableDrivers.map((driver) => {
      const existing = [...vanAssignments, ...motorbikeAssignments].find(
        (a) => a.driver.userId === driver.userId,
      );
      return existing || { driver, orders: [] };
    });

    // ── STEP 3B: Density-Aware Initial Capacity Trimming ─────────────────────
    for (const assignment of driverAssignments) {
      if (assignment.orders.length === 0) continue;
      const driver = assignment.driver;
      const maxW = Number(driver.maxWeightKg);
      const isVan = isVanDriver(driver);

      // Compute cluster centroid
      const cLat =
        assignment.orders.reduce((s, o) => s + Number(o.latitude), 0) / assignment.orders.length;
      const cLng =
        assignment.orders.reduce((s, o) => s + Number(o.longitude), 0) / assignment.orders.length;

      // Keep orders that are closest to cluster centroid to preserve route compactness and reduce fuel
      assignment.orders.sort((a, b) => {
        const dA = haversine(cLat, cLng, Number(a.latitude), Number(a.longitude));
        const dB = haversine(cLat, cLng, Number(b.latitude), Number(b.longitude));
        return dA - dB;
      });

      const ordersToKeep: VrpOrder[] = [];
      let runningW = 0;

      for (const order of assignment.orders) {
        const w = Number(order.weightKg);
        if (
          ordersToKeep.length < VRP_CONFIG.MAX_STOPS_PER_VEHICLE &&
          runningW + w <= maxW + 0.001
        ) {
          ordersToKeep.push(order);
          runningW += w;
        }
      }
      assignment.orders = ordersToKeep;
    }

    // ── STEP 3C: Global Proximity Knapsack Backfill (Fill Vehicles to Actual Capacity) ──
    const assignedIds = new Set(driverAssignments.flatMap((da) => da.orders.map((o) => o.id)));
    const pendingOrders = feasibleOrders.filter(
      (o) => !assignedIds.has(o.id) && !unassignedOrders.some((u) => u.orderId === o.id),
    );

    // Sort pending orders: light orders first for motorbikes, heavy for vans
    pendingOrders.sort((a, b) => Number(a.weightKg) - Number(b.weightKg));

    // Pass 1: Backfill Motorbikes with feasible light orders (<= 20kg) to maximize their capacity
    for (const da of driverAssignments.filter((a) => !isVanDriver(a.driver))) {
      const driver = da.driver;
      const maxW = Number(driver.maxWeightKg);
      let curW = da.orders.reduce((s, o) => s + Number(o.weightKg), 0);

      while (curW < maxW && da.orders.length < VRP_CONFIG.MAX_STOPS_PER_VEHICLE) {
        let bestOrder: VrpOrder | null = null;
        let bestDist = Infinity;

        for (const order of pendingOrders) {
          if (assignedIds.has(order.id)) continue;
          const w = Number(order.weightKg);
          if (w > VRP_CONFIG.HEAVY_WEIGHT_THRESHOLD_KG) continue; // Must be light for motorbike
          if (curW + w > maxW + 0.001) continue; // STRICT HARD CONSTRAINT

          let minStopDist = Infinity;
          if (da.orders.length === 0) {
            minStopDist = haversine(
              depotCoords.lat,
              depotCoords.lng,
              Number(order.latitude),
              Number(order.longitude),
            );
          } else {
            for (const s of da.orders) {
              const d = haversine(
                Number(s.latitude),
                Number(s.longitude),
                Number(order.latitude),
                Number(order.longitude),
              );
              if (d < minStopDist) minStopDist = d;
            }
          }

          if (minStopDist < bestDist) {
            bestDist = minStopDist;
            bestOrder = order;
          }
        }

        if (!bestOrder) break;
        da.orders.push(bestOrder);
        assignedIds.add(bestOrder.id);
        curW += Number(bestOrder.weightKg);
      }
    }

    // Pass 2: Backfill Vans & Trucks with heavy orders first, then remaining standard orders
    for (const da of driverAssignments.filter((a) => isVanDriver(a.driver))) {
      const driver = da.driver;
      const maxW = Number(driver.maxWeightKg);
      let curW = da.orders.reduce((s, o) => s + Number(o.weightKg), 0);

      // Heavy orders first
      while (curW < maxW && da.orders.length < VRP_CONFIG.MAX_STOPS_PER_VEHICLE) {
        let bestOrder: VrpOrder | null = null;
        let bestDist = Infinity;

        for (const order of pendingOrders) {
          if (assignedIds.has(order.id)) continue;
          const w = Number(order.weightKg);
          if (w <= VRP_CONFIG.HEAVY_WEIGHT_THRESHOLD_KG) continue;
          if (curW + w > maxW + 0.001) continue; // STRICT HARD CONSTRAINT

          let minStopDist = Infinity;
          if (da.orders.length === 0) {
            minStopDist = haversine(
              depotCoords.lat,
              depotCoords.lng,
              Number(order.latitude),
              Number(order.longitude),
            );
          } else {
            for (const s of da.orders) {
              const d = haversine(
                Number(s.latitude),
                Number(s.longitude),
                Number(order.latitude),
                Number(order.longitude),
              );
              if (d < minStopDist) minStopDist = d;
            }
          }

          if (minStopDist < bestDist) {
            bestDist = minStopDist;
            bestOrder = order;
          }
        }

        if (!bestOrder) break;
        da.orders.push(bestOrder);
        assignedIds.add(bestOrder.id);
        curW += Number(bestOrder.weightKg);
      }

      // Then any remaining pending orders up to capacity
      while (curW < maxW && da.orders.length < VRP_CONFIG.MAX_STOPS_PER_VEHICLE) {
        let bestOrder: VrpOrder | null = null;
        let bestDist = Infinity;

        for (const order of pendingOrders) {
          if (assignedIds.has(order.id)) continue;
          const w = Number(order.weightKg);
          if (curW + w > maxW + 0.001) continue; // STRICT HARD CONSTRAINT

          let minStopDist = Infinity;
          if (da.orders.length === 0) {
            minStopDist = haversine(
              depotCoords.lat,
              depotCoords.lng,
              Number(order.latitude),
              Number(order.longitude),
            );
          } else {
            for (const s of da.orders) {
              const d = haversine(
                Number(s.latitude),
                Number(s.longitude),
                Number(order.latitude),
                Number(order.longitude),
              );
              if (d < minStopDist) minStopDist = d;
            }
          }

          if (minStopDist < bestDist) {
            bestDist = minStopDist;
            bestOrder = order;
          }
        }

        if (!bestOrder) break;
        da.orders.push(bestOrder);
        assignedIds.add(bestOrder.id);
        curW += Number(bestOrder.weightKg);
      }
    }

    // Collect truly unassigned orders that could not fit into the fleet's physical capacity
    for (const order of feasibleOrders) {
      if (!assignedIds.has(order.id) && !unassignedOrders.some((u) => u.orderId === order.id)) {
        unassignedOrders.push({
          orderId: order.id,
          code: order.code,
          reason: `Fleet capacity full (${order.weightKg} kg). Deferred to next shift.`,
        });
      }
    }

    // ── STEP 4: Shortest Path (TSP) + Inter-Route Local Search ────────────────
    const nodeToOrder = new Map<number, VrpOrder>();
    clusteredOrders.forEach((o, i) => nodeToOrder.set(i + 1, o));

    const mutableRoutes: MutableRoute[] = [];

    for (const assignment of driverAssignments) {
      if (assignment.orders.length === 0) continue;
      const driver = assignment.driver;

      // Phase 4A: Nearest-Neighbor Tour starting from Depot
      const remainingOrders = new Set<VrpOrder>(assignment.orders);
      const orderedStops: VrpOrder[] = [];
      let currentNodeIdx = 0; // depot

      while (remainingOrders.size > 0) {
        let nearestOrder: VrpOrder | null = null;
        let nearestDist = Infinity;

        for (const order of remainingOrders) {
          const nodeIdx = orderToNodeIdx.get(order.id)!;
          const dist = costMatrix.distKm(currentNodeIdx, nodeIdx);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestOrder = order;
          }
        }

        if (!nearestOrder) break;
        remainingOrders.delete(nearestOrder);
        orderedStops.push(nearestOrder);
        currentNodeIdx = orderToNodeIdx.get(nearestOrder.id)!;
      }

      // Phase 4B: Initial Intra-route 2-opt Improvement
      const stopNodeIndices = orderedStops.map((o) => orderToNodeIdx.get(o.id)!);
      const improvedNodeIndices = twoOptImprove(stopNodeIndices, costMatrix, 0);

      const routeWeightKg = assignment.orders.reduce((s, o) => s + Number(o.weightKg), 0);
      const routeVolumeM3 = assignment.orders.reduce((s, o) => s + Number(o.volumeM3), 0);

      mutableRoutes.push({
        driver,
        nodeIndices: improvedNodeIndices,
        totalWeight: routeWeightKg,
        totalVolume: routeVolumeM3,
      });
    }

    // Phase 4C: Cross-Route Optimization (Relocate & Swap) for minimal distance & fuel
    optimizeInterRoute(mutableRoutes, costMatrix, nodeToOrder);

    const routes: VrpRouteResult[] = [];

    for (const mRoute of mutableRoutes) {
      if (mRoute.nodeIndices.length === 0) continue;
      const driver = mRoute.driver;
      const routeOrders = mRoute.nodeIndices.map((ni) => nodeToOrder.get(ni)!);

      // Phase 4D: Time Window Feasibility & Arrival Times
      const { arrivalTimes } = checkTimeWindowFeasibility(
        routeOrders,
        costMatrix,
        [0, ...mRoute.nodeIndices],
        0,
      );

      // Phase 4E: Fetch OSRM Route Geometry
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
        for (let j = 0; j < fallbackNodes.length - 1; j++) {
          totalDist +=
            haversine(
              fallbackNodes[j].lat,
              fallbackNodes[j].lng,
              fallbackNodes[j + 1].lat,
              fallbackNodes[j + 1].lng,
            ) * 1.35;
        }
        totalTime = Math.round((totalDist / 25) * 60 + routeOrders.length * SERVICE_TIME_MIN);
      }

      const routeWeightKg = routeOrders.reduce((s, o) => s + Number(o.weightKg), 0);
      const routeVolumeM3 = routeOrders.reduce((s, o) => s + Number(o.volumeM3), 0);
      const maxWeight = Number(driver.maxWeightKg);
      const maxVolume = Number(driver.maxVolumeM3);

      // STRICT HARD CONSTRAINT: Route weight must NEVER exceed vehicle maxLoad
      if (routeWeightKg > maxWeight + 0.001) {
        throw new Error(
          `Vehicle capacity constraint violated: Route weight ${routeWeightKg}kg exceeds driver ${driver.userId} max weight ${maxWeight}kg`,
        );
      }
      if (maxVolume > 0 && routeVolumeM3 > maxVolume) {
        this.logger.debug(
          `Route volume ${routeVolumeM3.toFixed(3)}m3 for driver ${driver.userId} exceeds nominal volume ${maxVolume}m3; packed via standard logistics consolidation.`,
        );
      }

      // 8-Hour Shift Ceiling (480 minutes)
      if (totalTime > VRP_CONFIG.MAX_ROUTE_TIME_MIN) {
        this.logger.warn(
          `Shift duration limit: Driver ${driver.userId} estimated route time ${totalTime}min exceeds 8-hour shift (${VRP_CONFIG.MAX_ROUTE_TIME_MIN}min)`,
        );
      }

      if (totalDist > VRP_CONFIG.MAX_ROUTE_DISTANCE_KM) {
        this.logger.warn(
          `Route distance limit: Driver ${driver.userId} estimated distance ${totalDist}km exceeds limit (${VRP_CONFIG.MAX_ROUTE_DISTANCE_KM}km)`,
        );
      }

      // Fuel calculations
      const isVan = isVanDriver(driver);
      const fuelRate = isVan
        ? VRP_CONFIG.VAN_FUEL_RATE_L_PER_100KM
        : VRP_CONFIG.MOTORBIKE_FUEL_RATE_L_PER_100KM;
      const fuelPrice = isVan ? VRP_CONFIG.DIESEL_PRICE_VND : VRP_CONFIG.GASOLINE_PRICE_VND;
      const estimatedFuelLiters = Math.round(((totalDist * fuelRate) / 100) * 10) / 10;
      const estimatedFuelCostVnd = Math.round(estimatedFuelLiters * fuelPrice);

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
        estimatedFuelLiters,
        estimatedFuelCostVnd,
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
    const unassignedCount = unassignedOrders.length;
    const assignedCount = clusteredOrders.length - unassignedCount;
    console.log(
      `[VRP Solver] Optimization finished: assigned=${assignedCount}/${clusteredOrders.length} orders | unassigned/dropped=${unassignedCount} orders`,
    );
    if (unassignedCount > 0) {
      console.log(
        `[VRP Solver] Dropped node details:`,
        unassignedOrders.map((u) => `${u.code} (${u.reason})`).join(', '),
      );
    } else {
      console.log(
        `[VRP Solver] SUCCESS: All ${clusteredOrders.length} orders assigned to ${routes.length} vehicle routes within strict capacity limits (0 dropped)!`,
      );
    }

    const totalDistKm = routes.reduce((s, r) => s + r.totalDistanceKm, 0);
    const totalFuelLiters =
      Math.round(routes.reduce((s, r) => s + (r.estimatedFuelLiters ?? 0), 0) * 10) / 10;
    const totalFuelCostVnd = routes.reduce((s, r) => s + (r.estimatedFuelCostVnd ?? 0), 0);
    const optimizationTimeMs = Date.now() - startTime;

    this.logger.log(
      `VRP done in ${optimizationTimeMs}ms | routes=${routes.length} | ` +
        `assigned=${assignedCount} | unassigned=${unassignedCount} | ` +
        `dist=${totalDistKm}km | fuel=${totalFuelLiters}L (~${totalFuelCostVnd.toLocaleString('vi-VN')} VND)`,
    );

    return {
      routes,
      totalDistanceKm: Math.round(totalDistKm * 10) / 10,
      totalOrders: clusteredOrders.length,
      assignedOrders: clusteredOrders.length - unassignedOrders.length,
      unassignedOrders,
      optimizationTimeMs,
      depot,
      algorithmUsed: 'nearest-neighbor + 2-opt',
      totalFuelLiters,
      totalFuelCostVnd,
    };
  }
}
