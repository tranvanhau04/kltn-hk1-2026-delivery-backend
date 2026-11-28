import { Injectable, Logger } from '@nestjs/common';
import { CircuitBreaker } from '../../common/resilience/circuit-breaker';
import {
  CostMatrix,
  GeoPoint,
  IDistanceMatrixStrategy,
  RouteGeometryResult,
} from './distance-matrix.strategy.interface';
import { haversineKm } from './haversine-fallback.strategy';

const OSRM_BASE = 'https://router.project-osrm.org';
export const OSRM_MAX_COORDS = 100;
const OSRM_TIMEOUT_MS = 4000;

/**
 * Shared Circuit Breaker protecting all outbound HTTP calls to the OSRM public API.
 * Trips OPEN after 3 consecutive failures and fails fast for 30s so VRP & GraphService
 * immediately fall back to Haversine instead of stalling for tens of seconds.
 */
export const osrmCircuitBreaker = new CircuitBreaker({
  name: 'OSRM-API',
  failureThreshold: 3,
  cooldownMs: 30_000,
});

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

/**
 * OSRM Distance Matrix Strategy (backed by OSRM Table & Route APIs + CircuitBreaker).
 */
@Injectable()
export class OsrmDistanceStrategy implements IDistanceMatrixStrategy {
  readonly name = 'OsrmDistanceStrategy';
  private readonly logger = new Logger(OsrmDistanceStrategy.name);

  async buildCostMatrix(nodes: GeoPoint[]): Promise<CostMatrix | null> {
    if (nodes.length > OSRM_MAX_COORDS) {
      this.logger.warn(
        `${nodes.length} nodes exceeds OSRM limit (${OSRM_MAX_COORDS}) – delegating to fallback`,
      );
      return null;
    }

    const osrmCoords: [number, number][] = nodes.map((n) => [n.lng, n.lat]);
    const osrmMatrix = await this.fetchOsrmTable(osrmCoords);
    if (!osrmMatrix) {
      return null;
    }

    return {
      distKm: (i, j) => {
        if (osrmMatrix.distances?.[i]?.[j] !== undefined) {
          return osrmMatrix.distances[i][j] / 1000;
        }
        return haversineKm(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng) * 1.35;
      },
      durMin: (i, j) => {
        if (osrmMatrix.durations?.[i]?.[j] !== undefined) {
          return osrmMatrix.durations[i][j] / 60;
        }
        const dist = haversineKm(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng) * 1.35;
        return (dist / 30) * 60;
      },
    };
  }

  async fetchOsrmTable(
    coords: [number, number][],
  ): Promise<{ distances: number[][]; durations: number[][] } | null> {
    if (coords.length > OSRM_MAX_COORDS) return null;

    const coordStr = coords.map((c) => `${c[0]},${c[1]}`).join(';');
    const url = `${OSRM_BASE}/table/v1/driving/${coordStr}?annotations=distance,duration`;

    return osrmCircuitBreaker.execute(
      async () => {
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
          } catch (err) {
            if (attempt === 1) {
              await new Promise((r) => setTimeout(r, 400));
            } else {
              throw err;
            }
          }
        }
        throw new Error('OSRM Table API returned invalid or non-OK response');
      },
      () => null,
    );
  }

  async fetchRouteGeometry(
    coords: [number, number][],
    timeoutMs = OSRM_TIMEOUT_MS,
  ): Promise<RouteGeometryResult | null> {
    if (coords.length < 2) return null;

    const coordStr = coords.map((c) => `${c[0]},${c[1]}`).join(';');
    const url = `${OSRM_BASE}/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;

    return osrmCircuitBreaker.execute(
      async () => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const res = await fetchWithTimeout(url, timeoutMs);
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
          } catch (err) {
            if (attempt === 1) {
              await new Promise((r) => setTimeout(r, 400));
            } else {
              throw err;
            }
          }
        }
        throw new Error('OSRM Route API returned invalid or non-OK response');
      },
      () => null,
    );
  }
}
