import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Logger, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WsThrottlerGuard } from './guards/ws-throttler.guard';
import { TrackingLog } from '../entities/tracking-log.entity';
import { Shift, ShiftStatus } from '../entities/shift.entity';
import { User, UserRole } from '../entities/user.entity';

interface UpdateLocationPayload {
  shiftId?: string;
  latitude: number;
  longitude: number;
  batteryLevel?: number;
}

interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

interface AuthenticatedSocket extends Socket {
  user?: JwtPayload;
}

/**
 * TrackingGateway — Socket.io WebSocket gateway for real-time driver location tracking.
 *
 * Task 9.2: Realtime Tracking Gateway
 *
 * Rooms:
 *   - `active_drivers`  → all authenticated DRIVER connections
 *   - `driver_<userId>` → individual driver room (for targeted messages)
 *   - `dispatchers`     → ADMIN + DISPATCHER connections (receive broadcasts)
 *
 * Events (client → server):
 *   - `update_location` { shiftId?, latitude, longitude, batteryLevel? }
 *     → Saves to tracking_logs, broadcasts `driver_location_updated` to dispatchers
 *
 * Events (server → client):
 *   - `driver_location_updated` → emitted to `dispatchers` room
 *   - `connection_error`        → emitted to client when auth fails
 */
@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  namespace: '/',
})
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TrackingGateway.name);

  constructor(
    private readonly jwtService: JwtService,

    @InjectRepository(TrackingLog)
    private readonly trackingLogRepo: Repository<TrackingLog>,

    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle: Connection & Disconnection
  // ─────────────────────────────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    try {
      // Extract token from handshake.auth.token or Authorization header
      const auth = client.handshake.auth as Record<string, unknown> | undefined;
      const authToken = typeof auth?.token === 'string' ? auth.token : undefined;
      const rawAuthHeader = client.handshake.headers?.authorization;
      const authHeader =
        typeof rawAuthHeader === 'string' ? rawAuthHeader.replace('Bearer ', '') : undefined;

      const token: string | undefined = authToken || authHeader;

      if (!token) {
        this.logger.warn(`[WS] Client ${client.id} rejected: no token provided`);
        client.emit('connection_error', { message: 'Unauthorized: token required' });
        client.disconnect(true);
        return;
      }

      // Verify JWT
      let payload: JwtPayload;
      try {
        payload = this.jwtService.verify<JwtPayload>(token);
      } catch {
        this.logger.warn(`[WS] Client ${client.id} rejected: invalid/expired token`);
        client.emit('connection_error', { message: 'Unauthorized: invalid token' });
        client.disconnect(true);
        return;
      }

      // Store user info on the socket for later use in message handlers
      (client as AuthenticatedSocket).user = payload;

      const { sub: userId, role } = payload;

      // Task 12.1 Task 2: Strictly check JWT payload role
      // - DISPATCHER or ADMIN -> dispatchers room
      // - DRIVER -> active_drivers room
      // - Invalid role -> disconnect immediately
      const roleStr = String(role);
      if (roleStr === UserRole.DISPATCHER || roleStr === UserRole.ADMIN) {
        await client.join('dispatchers');
        this.logger.log(`[WS] ${role} ${userId} connected → room: dispatchers`);
      } else if (roleStr === UserRole.DRIVER) {
        await client.join('active_drivers');
        await client.join(`driver_${userId}`);
        this.logger.log(
          `[WS] DRIVER ${userId} connected → rooms: active_drivers, driver_${userId}`,
        );
      } else {
        this.logger.warn(`[WS] Client ${client.id} rejected: invalid role ${roleStr}`);
        client.emit('connection_error', { message: 'Unauthorized: invalid role' });
        client.disconnect(true);
        return;
      }

      // Acknowledge successful connection
      client.emit('connected', {
        message: 'WebSocket connection established',
        userId,
        role,
        rooms: Array.from(client.rooms),
      });
    } catch (err) {
      this.logger.error(`[WS] Unexpected error during handleConnection:`, err);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const user = (client as AuthenticatedSocket).user;
    if (user) {
      this.logger.log(`[WS] User ${user.sub} (${user.role}) disconnected (socket: ${client.id})`);
    } else {
      this.logger.log(`[WS] Unauthenticated client ${client.id} disconnected`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event: update_location
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Task 9.2 & Task 12.1: Receives real-time GPS location from authenticated DRIVER.
   *
   * Rate limiting: Exactly 20 requests per minute via WsThrottlerGuard.
   *
   * Payload: { shiftId?, latitude, longitude, batteryLevel? }
   *
   * Processing:
   *   1. Validate rate limit (WsThrottlerGuard)
   *   2. Validate sender is DRIVER
   *   3. Validate payload coordinates
   *   4. Persist to tracking_logs table
   *   5. Broadcast `driver_location_updated` to `dispatchers` room
   *   6. Return acknowledgement to driver
   */
  @UseGuards(WsThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 }, ws: { limit: 20, ttl: 60000 } })
  @SubscribeMessage('update_location')
  async handleUpdateLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: UpdateLocationPayload,
  ): Promise<{ success: boolean; message?: string }> {
    const user = (client as AuthenticatedSocket).user;

    // Guard: must be authenticated
    if (!user) {
      throw new WsException('Unauthorized: not authenticated');
    }

    // Guard: only DRIVER can send location updates
    if (user.role !== UserRole.DRIVER) {
      throw new WsException('Forbidden: only DRIVER can send location updates');
    }

    const { latitude, longitude, shiftId, batteryLevel } = payload;

    // Validate coordinates
    if (
      latitude == null ||
      longitude == null ||
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new WsException('Invalid payload: latitude and longitude must be valid numbers');
    }

    const driverId = user.sub;

    // Resolve actual shiftId: use from payload or find the driver's open shift
    let resolvedShiftId: string | null = shiftId || null;
    if (!resolvedShiftId) {
      const openShift = await this.shiftRepo.findOne({
        where: { driverId, status: ShiftStatus.OPEN },
      });
      resolvedShiftId = openShift?.id ?? null;
    }

    // Fetch user info for broadcast (fullName, licensePlate)
    const userRecord = await this.userRepo.findOne({ where: { id: driverId } });

    // Persist tracking log
    const log = this.trackingLogRepo.create({
      driverId,
      shiftId: resolvedShiftId,
      latitude,
      longitude,
      batteryLevel: batteryLevel ?? null,
      // legacy timestamp field
      timestamp: new Date(),
    });
    const savedLog = await this.trackingLogRepo.save(log);

    this.logger.debug(
      `[WS] DRIVER ${driverId} location saved: (${latitude}, ${longitude}), shiftId=${resolvedShiftId}`,
    );

    // Broadcast to dispatchers room
    const broadcastPayload = {
      driverId,
      fullName: userRecord?.fullName ?? 'Unknown Driver',
      latitude: Number(savedLog.latitude),
      longitude: Number(savedLog.longitude),
      batteryLevel: savedLog.batteryLevel,
      shiftId: resolvedShiftId,
      timestamp: savedLog.createdAt ?? savedLog.timestamp,
      trackingLogId: savedLog.id,
    };

    this.server.to('dispatchers').emit('driver_location_updated', broadcastPayload);

    this.logger.log(
      `[WS] Broadcast driver_location_updated → dispatchers (driver: ${driverId}, lat: ${latitude}, lng: ${longitude})`,
    );

    return { success: true, message: 'Location updated and broadcasted' };
  }
}
