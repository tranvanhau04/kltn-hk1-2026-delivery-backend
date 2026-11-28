import { HaversineFallbackStrategy } from './haversine-fallback.strategy';
import { OsrmDistanceStrategy, osrmCircuitBreaker } from './osrm-distance.strategy';
import { CircuitState } from '../../common/resilience/circuit-breaker';

describe('Distance Matrix Strategies (VRP)', () => {
  const nodes = [
    { lat: 10.8468, lng: 106.6752 },
    { lat: 10.7626, lng: 106.6602 },
  ];

  afterEach(() => {
    osrmCircuitBreaker.reset();
    jest.restoreAllMocks();
  });

  it('HaversineFallbackStrategy computes positive distance and duration deterministically', async () => {
    const strategy = new HaversineFallbackStrategy();
    const matrix = await strategy.buildCostMatrix(nodes);

    expect(matrix.distKm(0, 0)).toBe(0);
    expect(matrix.distKm(0, 1)).toBeGreaterThan(10);
    expect(matrix.durMin(0, 1)).toBeCloseTo((matrix.distKm(0, 1) / 30) * 60, 5);
  });

  it('OsrmDistanceStrategy returns OSRM matrix when API responds Ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          code: 'Ok',
          distances: [
            [0, 12500],
            [12800, 0],
          ],
          durations: [
            [0, 1500],
            [1560, 0],
          ],
        }),
    });

    const strategy = new OsrmDistanceStrategy();
    const matrix = await strategy.buildCostMatrix(nodes);

    expect(matrix).not.toBeNull();
    expect(matrix!.distKm(0, 1)).toBe(12.5);
    expect(matrix!.durMin(0, 1)).toBe(25);
  });

  it('OsrmDistanceStrategy trips shared CircuitBreaker after 3 failures and fails fast', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('OSRM offline'));
    global.fetch = fetchMock;

    const strategy = new OsrmDistanceStrategy();

    // 3 failed calls (2 internal attempts each = 6 fetch calls) -> trips circuit OPEN
    for (let i = 0; i < 3; i++) {
      expect(await strategy.buildCostMatrix(nodes)).toBeNull();
    }
    expect(osrmCircuitBreaker.getState()).toBe(CircuitState.OPEN);
    const callsBeforeOpen = fetchMock.mock.calls.length;

    // 4th call must fail fast without hitting fetch at all
    expect(await strategy.buildCostMatrix(nodes)).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(callsBeforeOpen);
  });
});
