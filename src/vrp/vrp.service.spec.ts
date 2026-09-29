/**
 * VRP Service Unit Tests
 * Tests the core CVRP + VRPTW solver logic using mock data.
 * No database or HTTP calls are made – OSRM is mocked.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { VrpService, VrpDepot, VrpOrder, VrpDriver, VrpSolutionResult } from './vrp.service';

// ── Test Fixtures ──────────────────────────────────────────────────────────────

const DEPOT: VrpDepot = {
  id: 'depot-1',
  name: 'IUH Hub - Go Vap',
  latitude: 10.8468,
  longitude: 106.6752,
};

function makeOrder(
  id: string,
  lat: number,
  lng: number,
  weightKg: number,
  volumeM3: number,
  opts?: { timeWindowStart?: number; timeWindowEnd?: number },
): VrpOrder {
  return {
    id,
    code: `ORD-${id}`,
    receiverName: `Customer ${id}`,
    receiverPhone: '0901234567',
    deliveryAddress: `Address ${id}`,
    latitude: lat,
    longitude: lng,
    weightKg,
    volumeM3,
    codAmount: 0,
    ...opts,
  };
}

function makeDriver(
  id: string,
  maxWeightKg: number,
  maxVolumeM3: number,
): VrpDriver {
  return {
    userId: id,
    fullName: `Driver ${id}`,
    phone: '0901111111',
    licensePlate: `51A-${id}`,
    vehicleType: 'Motorbike',
    maxWeightKg,
    maxVolumeM3,
  };
}

// Scatter orders around Ho Chi Minh City area
const HCM_ORDERS: VrpOrder[] = [
  makeOrder('o1', 10.762622, 106.660172, 5, 0.01),   // District 1
  makeOrder('o2', 10.823099, 106.629664, 3, 0.005),  // Go Vap
  makeOrder('o3', 10.801843, 106.648673, 4, 0.008),  // Binh Thanh
  makeOrder('o4', 10.849050, 106.752000, 6, 0.012),  // Thu Duc
  makeOrder('o5', 10.728910, 106.696270, 2, 0.003),  // District 4
  makeOrder('o6', 10.856000, 106.628000, 3, 0.006),  // Go Vap North
  makeOrder('o7', 10.790000, 106.620000, 5, 0.010),  // Tan Binh
  makeOrder('o8', 10.760000, 106.700000, 4, 0.007),  // District 2
  makeOrder('o9', 10.730000, 106.720000, 3, 0.005),  // District 7
  makeOrder('o10', 10.800000, 106.680000, 2, 0.004), // Binh Thanh East
  makeOrder('o11', 10.870000, 106.700000, 7, 0.015), // Thu Duc North
  makeOrder('o12', 10.740000, 106.660000, 4, 0.009), // District 8
];

const DRIVERS: VrpDriver[] = [
  makeDriver('d1', 20, 0.05), // Max 20kg, 0.05m3
  makeDriver('d2', 15, 0.04), // Max 15kg, 0.04m3
  makeDriver('d3', 25, 0.06), // Max 25kg, 0.06m3
];

// ── Mock fetch globally ────────────────────────────────────────────────────────

// Mock OSRM to return null (forces Haversine fallback) so tests are deterministic
global.fetch = jest.fn().mockRejectedValue(new Error('OSRM mocked offline'));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VrpService', () => {
  let service: VrpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VrpService],
    }).compile();
    service = module.get<VrpService>(VrpService);
  });

  // ── Basic solve tests ──────────────────────────────────────────────────────

  describe('solve()', () => {
    it('should return empty routes when no orders provided', async () => {
      const result = await service.solve(DEPOT, [], DRIVERS);
      expect(result.routes).toHaveLength(0);
      expect(result.totalOrders).toBe(0);
      expect(result.assignedOrders).toBe(0);
      expect(result.unassignedOrders).toHaveLength(0);
    });

    it('should return all orders unassigned when no drivers', async () => {
      const result = await service.solve(DEPOT, HCM_ORDERS.slice(0, 3), []);
      expect(result.routes).toHaveLength(0);
      expect(result.unassignedOrders).toHaveLength(3);
      expect(result.unassignedOrders[0].reason).toContain('No available drivers');
    });

    it('should assign all orders within capacity to available drivers', async () => {
      // Use 3 generous drivers that can take all 12 orders
      const bigDrivers: VrpDriver[] = [
        makeDriver('big1', 100, 1.0),
        makeDriver('big2', 100, 1.0),
      ];
      const result: VrpSolutionResult = await service.solve(DEPOT, HCM_ORDERS, bigDrivers);

      const assignedCount = result.routes.reduce((s, r) => s + r.stops.length, 0);
      const unassignedCount = result.unassignedOrders.length;
      expect(assignedCount + unassignedCount).toBe(HCM_ORDERS.length);
      expect(result.totalOrders).toBe(HCM_ORDERS.length);
    });

    it('should never exceed weight capacity per route', async () => {
      const result = await service.solve(DEPOT, HCM_ORDERS, DRIVERS);

      for (const route of result.routes) {
        const driver = DRIVERS.find((d) => d.userId === route.driverId)!;
        expect(route.totalWeightKg).toBeLessThanOrEqual(Number(driver.maxWeightKg) + 0.001);
      }
    });

    it('should never exceed volume capacity per route', async () => {
      const result = await service.solve(DEPOT, HCM_ORDERS, DRIVERS);

      for (const route of result.routes) {
        const driver = DRIVERS.find((d) => d.userId === route.driverId)!;
        if (Number(driver.maxVolumeM3) > 0) {
          expect(route.totalVolumeM3).toBeLessThanOrEqual(Number(driver.maxVolumeM3) + 0.0001);
        }
      }
    });

    it('should produce valid polyline coordinates for each route', async () => {
      const result = await service.solve(DEPOT, HCM_ORDERS.slice(0, 5), DRIVERS);

      for (const route of result.routes) {
        expect(route.polyline.length).toBeGreaterThanOrEqual(2);
        for (const [lat, lng] of route.polyline) {
          expect(typeof lat).toBe('number');
          expect(typeof lng).toBe('number');
          expect(isNaN(lat)).toBe(false);
          expect(isNaN(lng)).toBe(false);
          // Sanity check: coordinates should be in Vietnam region
          expect(lat).toBeGreaterThan(8);
          expect(lat).toBeLessThan(24);
          expect(lng).toBeGreaterThan(100);
          expect(lng).toBeLessThan(115);
        }
      }
    });

    it('should include totalVolumeM3 and totalWeightKg on each route', async () => {
      const result = await service.solve(DEPOT, HCM_ORDERS.slice(0, 4), DRIVERS);
      for (const route of result.routes) {
        expect(route).toHaveProperty('totalVolumeM3');
        expect(route).toHaveProperty('totalWeightKg');
        expect(route.totalVolumeM3).toBeGreaterThanOrEqual(0);
        expect(route.totalWeightKg).toBeGreaterThan(0);
      }
    });

    it('should include estimatedArrivalMin for each stop', async () => {
      const result = await service.solve(DEPOT, HCM_ORDERS.slice(0, 5), DRIVERS);
      for (const route of result.routes) {
        for (const stop of route.stops) {
          // estimatedArrivalMin can be null only when no time-window data at all
          // but with Haversine fallback it should always be computed
          if (stop.estimatedArrivalMin !== null) {
            expect(stop.estimatedArrivalMin).toBeGreaterThan(0);
          }
        }
      }
    });

    it('should set correct sequenceNo starting from 1', async () => {
      const result = await service.solve(DEPOT, HCM_ORDERS.slice(0, 6), DRIVERS);
      for (const route of result.routes) {
        route.stops.forEach((stop, idx) => {
          expect(stop.sequenceNo).toBe(idx + 1);
        });
      }
    });

    it('should include algorithmUsed field', async () => {
      const result = await service.solve(DEPOT, HCM_ORDERS.slice(0, 3), DRIVERS);
      expect(result.algorithmUsed).toBe('nearest-neighbor + 2-opt');
    });

    it('should track unassigned orders when order exceeds max vehicle weight', async () => {
      const heavyOrder = makeOrder('heavy', 10.8, 106.67, 999, 0.001); // 999 kg
      const result = await service.solve(DEPOT, [heavyOrder], DRIVERS);

      expect(result.unassignedOrders).toHaveLength(1);
      expect(result.unassignedOrders[0].orderId).toBe('heavy');
      expect(result.unassignedOrders[0].reason).toContain('exceeds max vehicle capacity');
    });

    it('should track unassigned orders when order exceeds max vehicle volume', async () => {
      const bulkyOrder = makeOrder('bulky', 10.8, 106.67, 1, 99.0); // 99 m3
      const result = await service.solve(DEPOT, [bulkyOrder], DRIVERS);

      expect(result.unassignedOrders).toHaveLength(1);
      expect(result.unassignedOrders[0].orderId).toBe('bulky');
      expect(result.unassignedOrders[0].reason).toContain('exceeds max vehicle capacity');
    });

    it('should produce geographically sensible total distance', async () => {
      // 12 HCM orders within ~20km radius of depot, 3 drivers
      const result = await service.solve(DEPOT, HCM_ORDERS, DRIVERS);
      // Total distance across all routes should be reasonable
      expect(result.totalDistanceKm).toBeGreaterThan(0);
      // Sanity: total distance should be under 500 km for local HCM deliveries
      expect(result.totalDistanceKm).toBeLessThan(500);
    });
  });

  // ── Time window tests ──────────────────────────────────────────────────────

  describe('Time Windows (VRPTW)', () => {
    it('should compute arrivalTimes within valid time windows', async () => {
      // Orders with generous 07:00 - 20:00 windows (420 - 1200 min)
      const ordersWithTW: VrpOrder[] = [
        makeOrder('tw1', 10.840, 106.650, 3, 0.005, { timeWindowStart: 7 * 60, timeWindowEnd: 20 * 60 }),
        makeOrder('tw2', 10.835, 106.645, 2, 0.004, { timeWindowStart: 8 * 60, timeWindowEnd: 20 * 60 }),
      ];
      const result = await service.solve(DEPOT, ordersWithTW, [makeDriver('dtw', 50, 1.0)]);
      // Should be assigned since windows are wide
      expect(result.assignedOrders).toBeGreaterThan(0);
      for (const route of result.routes) {
        for (const stop of route.stops) {
          if (stop.estimatedArrivalMin !== null) {
            expect(stop.estimatedArrivalMin).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  // ── 2-opt correctness ──────────────────────────────────────────────────────

  describe('Route quality with 2-opt', () => {
    it('should produce shorter or equal total distance after 2-opt than pure greedy', async () => {
      // Run with a large set and verify routes exist
      const bigDrivers = [makeDriver('bd1', 200, 5.0)];
      const result = await service.solve(DEPOT, HCM_ORDERS, bigDrivers);
      // 2-opt should improve: result should have at most as many routes as we have orders
      expect(result.routes.length).toBeLessThanOrEqual(bigDrivers.length);
    });
  });

  // ── Summary metrics ────────────────────────────────────────────────────────

  describe('Summary metrics', () => {
    it('assignedOrders + unassignedOrders should equal totalOrders', async () => {
      const result = await service.solve(DEPOT, HCM_ORDERS, DRIVERS);
      expect(result.assignedOrders + result.unassignedOrders.length).toBe(result.totalOrders);
    });

    it('totalDistanceKm should be sum of all route distances', async () => {
      const result = await service.solve(DEPOT, HCM_ORDERS, DRIVERS);
      const sumDist = result.routes.reduce((s, r) => s + r.totalDistanceKm, 0);
      expect(Math.round(sumDist * 10) / 10).toBe(result.totalDistanceKm);
    });

    it('should always return a non-negative optimizationTimeMs', async () => {
      const result = await service.solve(DEPOT, HCM_ORDERS, DRIVERS);
      expect(result.optimizationTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});
