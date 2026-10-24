import { CanActivate, ExecutionContext, Injectable, Logger, Optional } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

interface AuthenticatedSocket extends Socket {
  user?: {
    sub: string;
    role?: string;
    email?: string;
  };
}

/**
 * WsThrottlerGuard — Task 12.1 / Task 1: WebSocket Rate Limiter
 *
 * Restricts clients to exactly 20 requests per minute for the `update_location` event.
 * Combines @nestjs/throttler storage with a fast in-memory sliding log token bucket.
 */
@Injectable()
export class WsThrottlerGuard implements CanActivate {
  private readonly logger = new Logger(WsThrottlerGuard.name);

  // Fast in-memory sliding window tracker: Map<trackerKey, timestamp[]>
  private readonly timestampsMap = new Map<string, number[]>();

  // Rate limit settings: exactly 20 requests per minute (60,000 ms)
  private readonly limit = 20;
  private readonly ttlMs = 60000;

  constructor(
    @Optional()
    private readonly storageService?: ThrottlerStorageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'ws') {
      return true;
    }

    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    const tracker = client?.user?.sub || client?.id || 'unknown';
    const key = `ws:update_location:${tracker}`;

    // 1. Check with @nestjs/throttler storage if available
    if (this.storageService && typeof this.storageService.increment === 'function') {
      try {
        const { totalHits, isBlocked, timeToBlockExpire } = await this.storageService.increment(
          key,
          this.ttlMs,
          this.limit,
          this.ttlMs,
          'ws',
        );

        if (isBlocked || totalHits > this.limit) {
          this.logger.warn(
            `[WS RateLimit] Exceeded for client ${tracker} (${totalHits}/${this.limit} req/min). Blocked for ${timeToBlockExpire}s`,
          );
          client.emit('error', {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Rate limit exceeded: maximum 20 requests per minute for update_location',
            retryAfter: timeToBlockExpire,
          });
          throw new WsException('Rate limit exceeded: maximum 20 requests per minute');
        }

        return true;
      } catch (err) {
        if (err instanceof WsException) {
          throw err;
        }
        // Fall back to in-memory sliding window check below
      }
    }

    // 2. In-memory sliding log check (guarantees exactly 20 requests per 60 seconds)
    const now = Date.now();
    const timestamps = this.timestampsMap.get(tracker) || [];

    // Filter out timestamps older than ttlMs
    const activeTimestamps = timestamps.filter((t) => now - t < this.ttlMs);

    if (activeTimestamps.length >= this.limit) {
      const oldestTimestamp = activeTimestamps[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldestTimestamp + this.ttlMs - now) / 1000));

      this.logger.warn(
        `[WS RateLimit] Exceeded for client ${tracker} (${activeTimestamps.length}/${this.limit} req/min). Retry after ${retryAfterSec}s`,
      );

      client.emit('error', {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded: maximum 20 requests per minute for update_location',
        retryAfter: retryAfterSec,
      });

      throw new WsException('Rate limit exceeded: maximum 20 requests per minute');
    }

    activeTimestamps.push(now);
    this.timestampsMap.set(tracker, activeTimestamps);

    return true;
  }
}
