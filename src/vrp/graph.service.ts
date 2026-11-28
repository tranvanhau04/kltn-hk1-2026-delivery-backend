import { Injectable, Optional } from '@nestjs/common';
import { OsrmDistanceStrategy } from './strategies/osrm-distance.strategy';
import { haversineKm } from './strategies/haversine-fallback.strategy';

export interface GraphNode {
  id: string;
  lat: number;
  lng: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  distanceKm: number;
  durationMin: number;
}

/**
 * Service to handle custom Shortest Path algorithms (Dijkstra / A*)
 * for the Graduation Thesis.
 */
@Injectable()
export class GraphService {
  private nodes: Map<string, GraphNode> = new Map();
  private adjList: Map<string, GraphEdge[]> = new Map();
  private readonly osrmStrategy: OsrmDistanceStrategy;

  constructor(@Optional() osrmStrategy?: OsrmDistanceStrategy) {
    this.osrmStrategy = osrmStrategy ?? new OsrmDistanceStrategy();
  }

  /**
   * Lấy đường đi thực tế trên bản đồ (Snap to roads) qua OSRM API (được bảo vệ bởi CircuitBreaker)
   * để giao diện hiển thị giống Google Maps (quẹo cua, rẽ nhánh).
   */
  async findShortestPath(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
  ): Promise<{ distanceKm: number; durationMin: number; polyline: [number, number][] }> {
    const osrmRoute = await this.osrmStrategy.fetchRouteGeometry(
      [
        [startLng, startLat],
        [endLng, endLat],
      ],
      2500,
    );

    if (osrmRoute) {
      return {
        distanceKm: osrmRoute.distance,
        durationMin: osrmRoute.duration,
        polyline: osrmRoute.polyline,
      };
    }

    // --- FALLBACK Haversine ---
    const distanceKm = haversineKm(startLat, startLng, endLat, endLng);
    const durationMin = (distanceKm / 30) * 60;
    const polyline: [number, number][] = [
      [startLat, startLng],
      [endLat, endLng],
    ];
    return { distanceKm, durationMin, polyline };
  }
}
