import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { INestApplicationContext, Logger } from '@nestjs/common';

export class RedisIoAdapter extends IoAdapter {
  private readonly redisLogger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);

    const pubClient = new Redis({
      host,
      port,
      lazyConnect: false,
    });
    const subClient = pubClient.duplicate();

    pubClient.on('connect', () => {
      this.redisLogger.log(`Redis PubClient connected to ${host}:${port}`);
    });
    subClient.on('connect', () => {
      this.redisLogger.log(`Redis SubClient connected to ${host}:${port}`);
    });
    pubClient.on('error', (err) => {
      this.redisLogger.error(`Redis PubClient error: ${err.message}`);
    });
    subClient.on('error', (err) => {
      this.redisLogger.error(`Redis SubClient error: ${err.message}`);
    });

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  async connectToRedis(): Promise<void> {
    // Connected automatically via ioredis
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}
