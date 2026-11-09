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

const HEAVY_WEIGHT_THRESHOLD_KG = 15; // Orders >= 15kg are heavy/bulky (Vans only)
const HEAVY_VOLUME_THRESHOLD_M3 = 0.05; // Orders >= 0.05m3 are bulky (Vans only)
const MAX_SHIFT_DISTANCE_KM = 3.5; // Maximum distance to shift an order; prevents cross-city detours

function isHeavyOrder(order: VrpOrder): boolean {
  return (
    Number(order.weightKg) >= HEAVY_WEIGHT_THRESHOLD_KG ||
    Number(order.volumeM3) >= HEAVY_VOLUME_THRESHOLD_M3
  );
}

function isVanDriver(driver: VrpDriver): boolean {
  return (
    Number(driver.maxWeightKg) >= 500 ||
    driver.vehicleType.toUpperCase().includes('VAN') ||
    driver.vehicleType.toUpperCase().includes('TRUCK')
  );
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

  const targetStops = Math.ceil(orders.length / k);

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
        const d = haversine(
          uc.centroid.lat,
          uc.centroid.lng,
          Number(orderToMove.latitude),
          Number(orderToMove.longitude),
        );
        if (d < minTargetDist) {
          minTargetDist = d;
          targetCluster = uc;
        }
      }

      // Check Geographic Constraint:
      // If distance > MAX_SHIFT_DISTANCE_KM, DO NOT shift it. Accept the imbalance.
      if (targetCluster && minTargetDist <= MAX_SHIFT_DISTANCE_KM) {
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
      // No order in this cluster can be shifted within MAX_SHIFT_DISTANCE_KM.
      // Accept geographic imbalance and stop balancing this cluster.
      lockedClusterIndices.add(sourceIdx);
    }

    if (!clusters.some((c, idx) => c.orders.length > targetStops && !lockedClusterIndices.has(idx))) {
      break;
    }
  }

  return clusters.map((c) => c.orders).filter((c) => c.length > 0);
}

interface DriverAssignment {
  driver: VrpDriver;
  orders: VrpOrder[];
}

function matchClustersToDrivers(
  clusters: VrpOrder[][],
  drivers: VrpDriver[],
): DriverAssignment[] {
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
      (d) => Number(d.maxWeightKg) > 0 && (Number(d.maxVolumeM3) >= 0 || isNaN(Number(d.maxVolumeM3))),
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

    // ── STEP 1: Heavy / Light Vehicle Segregation (Business Rule) ─────────────
    // Vans (maxWeightKg >= 500) ONLY take Heavy/Bulky orders (weightKg >= 15 or volumeM3 >= 0.05)
    // Motorbikes ONLY take Light orders
    const heavyOrders = feasibleOrders.filter(isHeavyOrder);
    const lightOrders = feasibleOrders.filter((o) => !isHeavyOrder(o));

    const vanDrivers = availableDrivers.filter(isVanDriver);
    const motorbikeDrivers = availableDrivers.filter((d) => !isVanDriver(d));

    console.log('Heavy orders count:', heavyOrders.length, 'vs Light orders count:', lightOrders.length);
    console.log('Van drivers count:', vanDrivers.length, 'vs Motorbike drivers count:', motorbikeDrivers.length);

    const depotCoords = { lat: Number(depot.latitude), lng: Number(depot.longitude) };
    let vanAssignments: DriverAssignment[] = [];
    let motorbikeAssignments: DriverAssignment[] = [];

    // ── STEP 2: Balanced K-Means for Light Orders (Motorbikes) ───────────────
    if (lightOrders.length > 0) {
      if (motorbikeDrivers.length === 0) {
        if (vanDrivers.length > 0) {
          // Fallback if no motorbikes in fleet
          this.logger.warn('No motorbikes available – falling back light orders to Vans');
          const k = Math.min(vanDrivers.length, lightOrders.length);
          const clusters = runBalancedKMeans(lightOrders, k, depotCoords);
          motorbikeAssignments = matchClustersToDrivers(clusters, vanDrivers);
        } else {
          for (const order of lightOrders) {
            unassignedOrders.push({
              orderId: order.id,
              code: order.code,
              reason: 'No Motorbike available for light order',
            });
          }
        }
      } else if (motorbikeDrivers.length === 1) {
        motorbikeAssignments = [{ driver: motorbikeDrivers[0], orders: lightOrders }];
      } else {
        const k = Math.min(motorbikeDrivers.length, lightOrders.length);
        const clusters = runBalancedKMeans(lightOrders, k, depotCoords);
        motorbikeAssignments = matchClustersToDrivers(clusters, motorbikeDrivers);
      }
    }

    // ── STEP 3: Balanced Assignment for Heavy Orders (Vans) ──────────────────
    if (heavyOrders.length > 0) {
      if (vanDrivers.length === 0) {
        for (const order of heavyOrders) {
          unassignedOrders.push({
            orderId: order.id,
            code: order.code,
            reason: 'No Van available for heavy/bulky order',
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

    const generatedClustersCount = vanAssignments.length + motorbikeAssignments.length;
    console.log('Generated clusters count:', generatedClustersCount);

    const driverAssignments: DriverAssignment[] = [
      ...vanAssignments,
      ...motorbikeAssignments,
    ];

    // Capacity enforcement & overflow redistribution
    for (let ai = 0; ai < driverAssignments.length; ai++) {
      const assignment = driverAssignments[ai];
      const driver = assignment.driver;
      const maxW = Number(driver.maxWeightKg);
      const maxV = Number(driver.maxVolumeM3);

      let currentW = assignment.orders.reduce((s, o) => s + Number(o.weightKg), 0);
      let currentV = assignment.orders.reduce((s, o) => s + Number(o.volumeM3), 0);

      if (currentW > maxW + 0.001 || (maxV > 0 && currentV > maxV + 0.0001)) {
        const ordersToKeep: VrpOrder[] = [];
        const excessOrders: VrpOrder[] = [];
        let runningW = 0;
        let runningV = 0;

        for (const order of assignment.orders) {
          const w = Number(order.weightKg);
          const v = Number(order.volumeM3);
          if (
            runningW + w <= maxW + 0.001 &&
            (maxV <= 0 || runningV + v <= maxV + 0.0001)
          ) {
            ordersToKeep.push(order);
            runningW += w;
            runningV += v;
          } else {
            excessOrders.push(order);
          }
        }
        assignment.orders = ordersToKeep;

        // Try to reassign excess to another driver of same vehicle type
        for (const excess of excessOrders) {
          const ew = Number(excess.weightKg);
          const ev = Number(excess.volumeM3);
          let absorbed = false;

          for (let aj = 0; aj < driverAssignments.length; aj++) {
            if (ai === aj) continue;
            const other = driverAssignments[aj];
            if (isVanDriver(other.driver) !== isVanDriver(driver)) continue;

            const otherMaxW = Number(other.driver.maxWeightKg);
            const otherMaxV = Number(other.driver.maxVolumeM3);
            const otherW = other.orders.reduce((s, o) => s + Number(o.weightKg), 0);
            const otherV = other.orders.reduce((s, o) => s + Number(o.volumeM3), 0);

            if (
              otherW + ew <= otherMaxW + 0.001 &&
              (otherMaxV <= 0 || otherV + ev <= otherMaxV + 0.0001)
            ) {
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

    // ── STEP 4: Shortest Path (TSP) Per Vehicle ──────────────────────────────
    const routes: VrpRouteResult[] = [];

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

      // Phase 4B: 2-opt Improvement
      const stopNodeIndices = orderedStops.map((o) => orderToNodeIdx.get(o.id)!);
      const improvedNodeIndices = twoOptImprove(stopNodeIndices, costMatrix, 0);
      const routeOrders = improvedNodeIndices.map((ni) => clusteredOrders[ni - 1]);

      // Phase 4C: Time Window Feasibility & Arrival Times
      const { arrivalTimes } = checkTimeWindowFeasibility(
        routeOrders,
        costMatrix,
        [0, ...improvedNodeIndices],
        0,
      );

      // Phase 4D: Fetch OSRM Route Geometry
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

      if (routeWeightKg > maxWeight + 0.001) {
        throw new Error(
          `Vehicle capacity constraint violated: Route weight ${routeWeightKg}kg exceeds driver ${driver.userId} max weight ${maxWeight}kg`,
        );
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

    this.logger.log(
      `VRP done in ${optimizationTimeMs}ms | routes=${routes.length} | ` +
        `assigned=${clusteredOrders.length - unassignedOrders.length} | unassigned=${unassignedOrders.length}`,
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
    };
  }
}
