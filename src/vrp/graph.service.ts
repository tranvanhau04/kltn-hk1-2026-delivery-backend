import { Injectable } from '@nestjs/common';

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

  constructor() {
    // TODO: Load OSM graph data or custom matrix here
    // e.g. read from a .json or .csv file of Ho Chi Minh city roads
  }

  /**
   * Tính khoảng cách đường chim bay (Haversine)
   */
  private haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Lấy đường đi thực tế trên bản đồ (Snap to roads) qua OSRM API
   * để giao diện hiển thị giống Google Maps (quẹo cua, rẽ nhánh).
   *
   * Trong KLTN, bạn có thể thay thế bằng thuật toán Dijkstra/A* của riêng bạn
   * nếu bạn đã parse thành công dữ liệu đường giao thông (OSM XML).
   */
  async findShortestPath(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
  ): Promise<{ distanceKm: number; durationMin: number; polyline: [number, number][] }> {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);

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
          const geometry = route.geometry;
          let polyline: [number, number][] = [];
          if (geometry && geometry.coordinates) {
            // OSRM trả về [lng, lat], ta cần map lại thành [lat, lng] cho React Native Maps
            polyline = geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
          }
          return {
            distanceKm: route.distance / 1000,
            durationMin: route.duration / 60,
            polyline,
          };
        }
      }
    } catch {
      // Bỏ qua lỗi mạng
    }

    // --- FALLBACK HAversine ---
    const distanceKm = this.haversine(startLat, startLng, endLat, endLng);
    const durationMin = (distanceKm / 30) * 60;
    const polyline: [number, number][] = [
      [startLat, startLng],
      [endLat, endLng],
    ];
    return { distanceKm, durationMin, polyline };
  }
}
