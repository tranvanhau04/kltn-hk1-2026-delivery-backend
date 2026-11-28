import { Logger } from '@nestjs/common';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  /** Human-readable name for logging and diagnostics */
  name: string;
  /** Number of consecutive failures before tripping the circuit to OPEN (default: 3) */
  failureThreshold?: number;
  /** Cooldown period in milliseconds before transitioning OPEN -> HALF_OPEN (default: 30000) */
  cooldownMs?: number;
}

export interface CircuitBreakerSnapshot {
  name: string;
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
}

export class CircuitOpenError extends Error {
  constructor(circuitName: string) {
    super(`Circuit breaker "${circuitName}" is OPEN — failing fast`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Lightweight, self-contained Circuit Breaker for protecting external HTTP calls
 * (e.g. OSRM routing/table API, Google Gemini LLM API).
 *
 * State machine:
 *   CLOSED --(failureThreshold consecutive failures)--> OPEN
 *   OPEN --(after cooldownMs elapsed)--> HALF_OPEN
 *   HALF_OPEN --(probe succeeds)--> CLOSED
 *   HALF_OPEN --(probe fails)--> OPEN
 */
export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  private state: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.cooldownMs = Math.max(100, options.cooldownMs ?? 30_000);
  }

  getState(now: number = Date.now()): CircuitState {
    if (
      this.state === CircuitState.OPEN &&
      this.openedAt !== null &&
      now - this.openedAt >= this.cooldownMs
    ) {
      this.state = CircuitState.HALF_OPEN;
      this.logger.log(`[CircuitBreaker:${this.name}] Cooldown elapsed -> HALF_OPEN (probing)`);
    }
    return this.state;
  }

  getSnapshot(now: number = Date.now()): CircuitBreakerSnapshot {
    return {
      name: this.name,
      state: this.getState(now),
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
    };
  }

  recordSuccess(): void {
    if (this.state !== CircuitState.CLOSED || this.consecutiveFailures > 0) {
      this.logger.log(`[CircuitBreaker:${this.name}] Probe succeeded -> CLOSED`);
    }
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  recordFailure(now: number = Date.now()): void {
    this.consecutiveFailures += 1;

    if (
      this.state === CircuitState.HALF_OPEN ||
      this.consecutiveFailures >= this.failureThreshold
    ) {
      const wasOpen = this.state === CircuitState.OPEN;
      this.state = CircuitState.OPEN;
      this.openedAt = now;
      if (!wasOpen) {
        this.logger.warn(
          `[CircuitBreaker:${this.name}] Tripped to OPEN after ${this.consecutiveFailures} consecutive failure(s). Cooldown: ${this.cooldownMs}ms`,
        );
      }
    }
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  /**
   * Executes an async operation guarded by the circuit breaker.
   * When the circuit is OPEN, fails fast immediately without calling `action`
   * and invokes `fallback` if provided.
   */
  async execute<T>(action: () => Promise<T>, fallback?: () => T | Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      if (fallback) {
        return await fallback();
      }
      throw new CircuitOpenError(this.name);
    }

    try {
      const result = await action();
      this.recordSuccess();
      return result;
    } catch (error: unknown) {
      this.recordFailure();
      if (fallback) {
        return await fallback();
      }
      throw error;
    }
  }
}
