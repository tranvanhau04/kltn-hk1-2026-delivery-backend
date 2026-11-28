import { Injectable } from '@nestjs/common';
import {
  CostMatrix,
  GeoPoint,
  IDistanceMatrixStrategy,
} from './distance-matrix.strategy.interface';

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle Haversine distance in kilometers.
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Deterministic Haversine Fallback Strategy.
 * Applies a 1.35x urban road tortuosity factor and 30 km/h average urban speed
 * so VRP optimization remains 100% available even when OSRM is unreachable.
 */
@Injectable()
export class HaversineFallbackStrategy implements IDistanceMatrixStrategy {
  readonly name = 'HaversineFallbackStrategy';

  buildCostMatrix(nodes: GeoPoint[]): Promise<CostMatrix> {
    return Promise.resolve(this.createSyncMatrix(nodes));
  }

  createSyncMatrix(nodes: GeoPoint[]): CostMatrix {
    return {
      distKm: (i, j) => haversineKm(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng) * 1.35,
      durMin: (i, j) => {
        const dist = haversineKm(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng) * 1.35;
        return (dist / 30) * 60;
      },
    };
  }
}
