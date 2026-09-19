export declare class MaxFlowService {
    constructor();
    calculateMaxFlow(_source: string, _sink: string, _capacities: unknown): {
        maxFlow: number;
        assignments: any;
    };
    assignOrdersToDrivers(_orders: unknown[], _drivers: unknown[]): {
        assigned: never[];
        unassigned: never[];
    };
}
