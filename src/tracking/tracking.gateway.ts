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
import { Logger } from '@nestjs/common';
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
    credentials: false,
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
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

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
      (client as any).user = payload;

      const { sub: userId, role } = payload;

      if (role === UserRole.DRIVER) {
        // Driver joins their own personal room and the shared drivers room
        await client.join('active_drivers');
        await client.join(`driver_${userId}`);
        this.logger.log(`[WS] DRIVER ${userId} connected → rooms: active_drivers, driver_${userId}`);
      } else if (role === UserRole.ADMIN || role === UserRole.DISPATCHER) {
        // Admin/Dispatcher joins dispatchers room to receive broadcasts
        await client.join('dispatchers');
        this.logger.log(`[WS] ${role} ${userId} connected → room: dispatchers`);
      } else {
        this.logger.warn(`[WS] Client ${client.id} has unknown role: ${role}`);
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
    const user = (client as any).user as JwtPayload | undefined;
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
   * Task 9.2: Receives real-time GPS location from authenticated DRIVER.
   *
   * Payload: { shiftId?, latitude, longitude, batteryLevel? }
   *
   * Processing:
   *   1. Validate sender is DRIVER
   *   2. Validate payload coordinates
   *   3. Persist to tracking_logs table
   *   4. Broadcast `driver_location_updated` to `dispatchers` room
   *   5. Return acknowledgement to driver
   */
  @SubscribeMessage('update_location')
  async handleUpdateLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: UpdateLocationPayload,
  ): Promise<{ success: boolean; message?: string }> {
    const user = (client as any).user as JwtPayload | undefined;

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
