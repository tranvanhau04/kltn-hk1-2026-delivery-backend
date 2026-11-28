import { CircuitBreaker, CircuitOpenError, CircuitState } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('starts in CLOSED state and returns action result on success', async () => {
    const breaker = new CircuitBreaker({ name: 'test-api', failureThreshold: 3, cooldownMs: 1000 });

    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    const result = await breaker.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(breaker.getSnapshot().consecutiveFailures).toBe(0);
  });

  it('trips to OPEN after reaching failureThreshold consecutive failures and fails fast', async () => {
    const breaker = new CircuitBreaker({
      name: 'osrm-test',
      failureThreshold: 3,
      cooldownMs: 30_000,
    });
    const failingAction = jest
      .fn<Promise<string>, []>()
      .mockRejectedValue(new Error('network timeout'));
    const fallback = jest.fn<string, []>().mockReturnValue('fallback-value');

    for (let i = 0; i < 3; i++) {
      const res = await breaker.execute<string>(failingAction, fallback);
      expect(res).toBe('fallback-value');
    }

    expect(breaker.getState()).toBe(CircuitState.OPEN);
    expect(failingAction).toHaveBeenCalledTimes(3);

    // Next call must fail fast without invoking failingAction
    const fastFailResult = await breaker.execute<string>(failingAction, fallback);
    expect(fastFailResult).toBe('fallback-value');
    expect(failingAction).toHaveBeenCalledTimes(3);
    expect(fallback).toHaveBeenCalledTimes(4);
  });

  it('throws CircuitOpenError when OPEN and no fallback is provided', async () => {
    const breaker = new CircuitBreaker({
      name: 'no-fallback-api',
      failureThreshold: 2,
      cooldownMs: 30_000,
    });

    await expect(breaker.execute(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(breaker.execute(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    expect(breaker.getState()).toBe(CircuitState.OPEN);
    await expect(breaker.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitOpenError);
  });

  it('transitions OPEN -> HALF_OPEN after cooldown and recovers to CLOSED on probe success', async () => {
    const breaker = new CircuitBreaker({
      name: 'recovery-api',
      failureThreshold: 2,
      cooldownMs: 100,
    });

    breaker.recordFailure(1000);
    breaker.recordFailure(1000);
    expect(breaker.getState(1050)).toBe(CircuitState.OPEN);
    expect(breaker.getState(1100)).toBe(CircuitState.HALF_OPEN);

    // Probe succeeds -> CLOSED
    const result = await breaker.execute(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.getSnapshot().consecutiveFailures).toBe(0);
  });

  it('re-opens immediately if HALF_OPEN probe fails', async () => {
    const breaker = new CircuitBreaker({
      name: 'flaky-api',
      failureThreshold: 2,
      cooldownMs: 100,
    });

    const openedAt = Date.now() - 200;
    breaker.recordFailure(openedAt);
    breaker.recordFailure(openedAt);
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    const res = await breaker.execute(
      () => Promise.reject(new Error('still down')),
      () => 'fallback',
    );
    expect(res).toBe('fallback');
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it('resets consecutive failure counter after a successful call', async () => {
    const breaker = new CircuitBreaker({
      name: 'intermittent-api',
      failureThreshold: 3,
      cooldownMs: 1000,
    });

    await breaker.execute(
      () => Promise.reject(new Error('fail 1')),
      () => null,
    );
    await breaker.execute(
      () => Promise.reject(new Error('fail 2')),
      () => null,
    );
    expect(breaker.getSnapshot().consecutiveFailures).toBe(2);

    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.getSnapshot().consecutiveFailures).toBe(0);
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });
});
