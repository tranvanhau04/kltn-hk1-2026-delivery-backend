export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface CostMatrix {
  distKm: (i: number, j: number) => number;
  durMin: (i: number, j: number) => number;
}

export interface RouteGeometryResult {
  distance: number;
  duration: number;
  polyline: [number, number][];
}

/**
 * Strategy contract for computing pairwise road distance & travel duration matrices
 * for the VRP solver (e.g., OSRM Table API vs. deterministic Haversine fallback).
 */
export interface IDistanceMatrixStrategy {
  readonly name: string;
  buildCostMatrix(nodes: GeoPoint[]): Promise<CostMatrix | null>;
}
