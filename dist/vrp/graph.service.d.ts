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
export declare class GraphService {
    private nodes;
    private adjList;
    constructor();
    private haversine;
    findShortestPath(startLat: number, startLng: number, endLat: number, endLng: number): Promise<{
        distanceKm: number;
        durationMin: number;
        polyline: [number, number][];
    }>;
}
