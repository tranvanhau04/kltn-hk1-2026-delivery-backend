import { Injectable } from '@nestjs/common';

/**
 * Service to handle Max Flow algorithms (Ford-Fulkerson, Edmonds-Karp)
 * for the Graduation Thesis.
 *
 * Thường được dùng để giải bài toán phân bổ năng lực (ví dụ: gán đơn hàng
 * cho tài xế/kho sao cho không vượt quá Capacity mà vẫn đạt Max Flow).
 */
@Injectable()
export class MaxFlowService {
  constructor() {}

  /**
   * Tính toán Max Flow trên đồ thị có hướng (Bipartite Graph, Flow Network)
   * @param source Node nguồn (Source)
   * @param sink Node đích (Sink)
   * @param capacities Ma trận hoặc danh sách cạnh sức chứa (Capacity)
   * @returns Max Flow value và luồng gán chi tiết
   */
  public calculateMaxFlow(
    _source: string,
    _sink: string,
    _capacities: unknown,
  ): { maxFlow: number; assignments: any } {
    // TODO: Implement Ford-Fulkerson or Edmonds-Karp here
    console.log(_source, _sink, _capacities);

    return {
      maxFlow: 0,
      assignments: {},
    };
  }

  /**
   * Ứng dụng Max Flow vào việc gom nhóm (Clustering) hoặc gán đơn hàng cho tài xế
   */
  public assignOrdersToDrivers(_orders: unknown[], _drivers: unknown[]) {
    // 1. Dựng Bipartite Graph
    // 2. Gọi calculateMaxFlow
    // 3. Trả về kết quả phân công

    // TODO: Implement assignment logic
    console.log(_orders, _drivers);
    return {
      assigned: [],
      unassigned: [],
    };
  }
}
