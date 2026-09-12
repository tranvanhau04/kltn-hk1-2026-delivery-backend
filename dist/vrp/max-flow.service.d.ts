export declare class MaxFlowService {
    constructor();
    calculateMaxFlow(source: string, sink: string, capacities: any): {
        maxFlow: number;
        assignments: any;
    };
    assignOrdersToDrivers(orders: any[], drivers: any[]): {
        assigned: never[];
        unassigned: never[];
    };
}
