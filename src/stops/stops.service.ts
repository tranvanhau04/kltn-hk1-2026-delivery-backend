import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

import { Stop } from '../entities/stop.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import { Route } from '../entities/route.entity';
import { Shift, ShiftStatus } from '../entities/shift.entity';
import { ProofOfDelivery } from '../entities/proof-of-delivery.entity';
import { OrderStatusHistory } from '../entities/order-status-history.entity';
import { UserRole } from '../entities/user.entity';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { SubmitPodDto } from './dto/submit-pod.dto';
import { FailStopDto } from './dto/fail-stop.dto';

@Injectable()
export class StopsService {
  private readonly logger = new Logger(StopsService.name);

  constructor(
    private readonly dataSource: DataSource,

    @InjectRepository(Stop)
    private readonly stopRepo: Repository<Stop>,

    @InjectRepository(Route)
    private readonly routeRepo: Repository<Route>,

    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,

    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,

    @InjectRepository(ProofOfDelivery)
    private readonly podRepo: Repository<ProofOfDelivery>,

    @InjectRepository(OrderStatusHistory)
    private readonly historyRepo: Repository<OrderStatusHistory>,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: Safely delete uploaded file from filesystem
  // ─────────────────────────────────────────────────────────────────────────────
  private async safeDeleteFile(filePath?: string) {
    if (!filePath) return;
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Không thể xóa file rác: ${filePath}`, message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // KLTN-84: PATCH /stops/:id/arrived
  // ─────────────────────────────────────────────────────────────────────────────
  async markArrived(stopId: string, user: JwtPayload) {
    const stop = await this.stopRepo.findOne({
      where: { id: stopId },
      relations: ['order'],
    });

    if (!stop) {
      throw new NotFoundException(`Không tìm thấy điểm dừng với id=${stopId}`);
    }

    const route = await this.routeRepo.findOne({ where: { id: stop.routeId } });
    if (!route) {
      throw new NotFoundException(`Không tìm thấy lộ trình của điểm dừng này`);
    }

    if (user.role === UserRole.DRIVER && route.driverId !== user.sub) {
      throw new ForbiddenException(`Bạn không được phân công lộ trình này`);
    }

    // Terminal states cannot be marked ARRIVED
    if (['COMPLETED', 'FAILED', 'SKIPPED'].includes(stop.status)) {
      throw new BadRequestException(
        `Điểm dừng đã ở trạng thái ${stop.status}, không thể chuyển sang ARRIVED`,
      );
    }

    // If already ARRIVED, return existing timestamp idempotently
    if (stop.status === 'ARRIVED') {
      return {
        success: true,
        data: {
          stopId: stop.id,
          status: stop.status,
          arrivedAt: stop.arrivedAt,
        },
      };
    }

    stop.status = 'ARRIVED';
    stop.arrivedAt = new Date();
    await this.stopRepo.save(stop);

    return {
      success: true,
      data: {
        stopId: stop.id,
        status: stop.status,
        arrivedAt: stop.arrivedAt,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // KLTN-85: POST /stops/:id/pod
  // ─────────────────────────────────────────────────────────────────────────────
  async submitPod(
    stopId: string,
    dto: SubmitPodDto,
    file: Express.Multer.File | undefined,
    user: JwtPayload,
  ) {
    // 1. Validate file existence
    if (!file) {
      throw new BadRequestException('Vui lòng tải lên ảnh chụp kiện hàng (field "file")');
    }

    // 2. Fetch stop & relations
    const stop = await this.stopRepo.findOne({
      where: { id: stopId },
      relations: ['order'],
    });

    if (!stop) {
      await this.safeDeleteFile(file.path);
      throw new NotFoundException(`Không tìm thấy điểm dừng với id=${stopId}`);
    }

    const route = await this.routeRepo.findOne({ where: { id: stop.routeId } });
    if (!route) {
      await this.safeDeleteFile(file.path);
      throw new NotFoundException(`Không tìm thấy lộ trình của điểm dừng này`);
    }

    if (user.role === UserRole.DRIVER && route.driverId !== user.sub) {
      await this.safeDeleteFile(file.path);
      throw new ForbiddenException(`Bạn không có quyền cập nhật điểm dừng này`);
    }

    // 3. State & Idempotency protection (Prevent double-COD and double-completion)
    if (stop.status === 'COMPLETED') {
      await this.safeDeleteFile(file.path);
      throw new ConflictException(
        'Điểm dừng này đã được giao hàng thành công trước đó (tránh ghi nhận 2 lần).',
      );
    }

    const existingPod = await this.podRepo.findOne({ where: { stopId } });
    if (existingPod) {
      await this.safeDeleteFile(file.path);
      throw new ConflictException(
        'Minh chứng giao hàng (POD) cho điểm dừng này đã tồn tại trong hệ thống.',
      );
    }

    // 4. Validate order and COD amount
    const order = stop.order;
    if (!order) {
      await this.safeDeleteFile(file.path);
      throw new BadRequestException('Điểm dừng không gắn với đơn hàng nào hợp lệ');
    }

    const expectedCod = Number(order.codAmount) || 0;
    let finalCod = expectedCod;

    if (dto.codCollected !== undefined && dto.codCollected !== null) {
      const collected = Number(dto.codCollected);
      if (isNaN(collected) || collected < 0 || collected > expectedCod) {
        await this.safeDeleteFile(file.path);
        throw new BadRequestException(
          `Số tiền COD thực thu (${collected}) không hợp lệ (phải từ 0 đến ${expectedCod})`,
        );
      }
      finalCod = collected;
    }

    // Relative web URL for photo
    const photoUrl = `/uploads/pod/${file.filename}`;

    // 5. Execute Database Transaction (File is already on disk, rollback unlinks it if DB fails)
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 5.1. Create ProofOfDelivery record
      const pod = queryRunner.manager.create(ProofOfDelivery, {
        id: uuidv4(),
        stopId: stop.id,
        photoUrl,
        codCollected: finalCod,
        failureReason: null,
        rescheduledDate: null,
        confirmedAt: new Date(),
      });
      await queryRunner.manager.save(pod);

      // 5.2. Update Stop: status = 'COMPLETED'
      stop.status = 'COMPLETED';
      if (!stop.arrivedAt) {
        stop.arrivedAt = new Date();
      }
      await queryRunner.manager.save(stop);

      // 5.3. Update Order: status = DELIVERED
      order.status = OrderStatus.DELIVERED;
      order.updatedAt = new Date();
      await queryRunner.manager.save(order);

      // 5.4. Append OrderStatusHistory
      const noteText = dto.notes?.trim()
        ? `Giao thành công: ${dto.notes.trim()}`
        : 'Giao hàng thành công';
      const history = queryRunner.manager.create(OrderStatusHistory, {
        id: uuidv4(),
        orderId: order.id,
        status: OrderStatus.DELIVERED,
        note: noteText,
        createdAt: new Date(),
      });
      await queryRunner.manager.save(history);

      // 5.5. Accumulate COD in active driver shift
      let shiftCodTotal = 0;
      const activeShift = await queryRunner.manager.findOne(Shift, {
        where: { driverId: route.driverId, status: ShiftStatus.OPEN },
        order: { startTime: 'DESC' },
      });

      if (activeShift) {
        if (finalCod > 0) {
          activeShift.codCollected = Number(activeShift.codCollected || 0) + finalCod;
          await queryRunner.manager.save(activeShift);
        }
        shiftCodTotal = Number(activeShift.codCollected);
      }

      // 5.6. Check route auto-completion
      const pendingStopsCount = await queryRunner.manager.count(Stop, {
        where: {
          routeId: route.id,
          status: In(['PENDING', 'ARRIVED']),
        },
      });

      if (pendingStopsCount === 0) {
        route.status = 'COMPLETED';
        await queryRunner.manager.save(route);
      }

      await queryRunner.commitTransaction();

      return {
        success: true,
        data: {
          stopId: stop.id,
          stopStatus: stop.status,
          orderStatus: order.status,
          codCollected: finalCod,
          shiftCodCollected: shiftCodTotal,
          photoUrl: pod.photoUrl,
        },
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      await this.safeDeleteFile(file.path);
      this.logger.error(`Lỗi khi lưu POD điểm dừng ${stopId}:`, err);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // KLTN-86: POST /stops/:id/fail
  // ─────────────────────────────────────────────────────────────────────────────
  async failStop(
    stopId: string,
    dto: FailStopDto,
    file: Express.Multer.File | undefined,
    user: JwtPayload,
  ) {
    // 1. Business validations for action vs rescheduledDate
    if (dto.action === 'RESCHEDULED') {
      if (!dto.rescheduledDate) {
        await this.safeDeleteFile(file?.path);
        throw new BadRequestException('rescheduledDate là bắt buộc khi action là RESCHEDULED');
      }
      const rescheduleTime = new Date(dto.rescheduledDate).getTime();
      if (isNaN(rescheduleTime) || rescheduleTime <= Date.now()) {
        await this.safeDeleteFile(file?.path);
        throw new BadRequestException(
          'rescheduledDate phải là một mốc thời gian hợp lệ trong tương lai',
        );
      }
    } else if (dto.action === 'FAILED') {
      if (dto.rescheduledDate) {
        await this.safeDeleteFile(file?.path);
        throw new BadRequestException('rescheduledDate không được truyền khi action là FAILED');
      }
    }

    // 2. Fetch stop & relations
    const stop = await this.stopRepo.findOne({
      where: { id: stopId },
      relations: ['order'],
    });

    if (!stop) {
      await this.safeDeleteFile(file?.path);
      throw new NotFoundException(`Không tìm thấy điểm dừng với id=${stopId}`);
    }

    const route = await this.routeRepo.findOne({ where: { id: stop.routeId } });
    if (!route) {
      await this.safeDeleteFile(file?.path);
      throw new NotFoundException(`Không tìm thấy lộ trình của điểm dừng này`);
    }

    if (user.role === UserRole.DRIVER && route.driverId !== user.sub) {
      await this.safeDeleteFile(file?.path);
      throw new ForbiddenException(`Bạn không có quyền cập nhật điểm dừng này`);
    }

    // 3. State & Idempotency protection
    if (['COMPLETED', 'FAILED', 'SKIPPED'].includes(stop.status)) {
      await this.safeDeleteFile(file?.path);
      throw new ConflictException(
        `Điểm dừng đã ở trạng thái ${stop.status}, không thể chuyển sang ${dto.action}`,
      );
    }

    const existingPod = await this.podRepo.findOne({ where: { stopId } });
    if (existingPod) {
      await this.safeDeleteFile(file?.path);
      throw new ConflictException('Điểm dừng này đã có minh chứng / kết quả xử lý trước đó.');
    }

    const order = stop.order;
    if (!order) {
      await this.safeDeleteFile(file?.path);
      throw new BadRequestException('Điểm dừng không gắn với đơn hàng nào hợp lệ');
    }

    const photoUrl = file ? `/uploads/pod/${file.filename}` : null;
    const rescheduledDate = dto.action === 'RESCHEDULED' ? new Date(dto.rescheduledDate!) : null;

    // 4. Execute Database Transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 4.1. Create ProofOfDelivery record (Failure Evidence)
      const pod = queryRunner.manager.create(ProofOfDelivery, {
        id: uuidv4(),
        stopId: stop.id,
        photoUrl,
        codCollected: 0,
        failureReason: dto.failureReason,
        rescheduledDate,
        confirmedAt: new Date(),
      });
      await queryRunner.manager.save(pod);

      // 4.2. Update Stop status:
      // Note: DB check constraint chk_stop_status allows: ('PENDING', 'ARRIVED', 'COMPLETED', 'FAILED', 'SKIPPED')
      // If action === RESCHEDULED → stop.status = 'SKIPPED'
      // If action === FAILED → stop.status = 'FAILED'
      const newStopStatus = dto.action === 'RESCHEDULED' ? 'SKIPPED' : 'FAILED';
      stop.status = newStopStatus;
      if (!stop.arrivedAt) {
        stop.arrivedAt = new Date();
      }
      await queryRunner.manager.save(stop);

      // 4.3. Update Order status
      const newOrderStatus =
        dto.action === 'RESCHEDULED' ? OrderStatus.RESCHEDULED : OrderStatus.FAILED;
      order.status = newOrderStatus;
      order.updatedAt = new Date();
      await queryRunner.manager.save(order);

      // 4.4. Append OrderStatusHistory
      const noteText =
        dto.action === 'RESCHEDULED'
          ? `Hẹn giao lại: ${dto.rescheduledDate}. Lý do: ${dto.failureReason}`
          : `Giao thất bại: ${dto.failureReason}`;
      const history = queryRunner.manager.create(OrderStatusHistory, {
        id: uuidv4(),
        orderId: order.id,
        status: newOrderStatus,
        note: noteText,
        createdAt: new Date(),
      });
      await queryRunner.manager.save(history);

      // 4.5. Check route auto-completion
      const pendingStopsCount = await queryRunner.manager.count(Stop, {
        where: {
          routeId: route.id,
          status: In(['PENDING', 'ARRIVED']),
        },
      });

      if (pendingStopsCount === 0) {
        route.status = 'COMPLETED';
        await queryRunner.manager.save(route);
      }

      await queryRunner.commitTransaction();

      return {
        success: true,
        data: {
          stopId: stop.id,
          stopStatus: stop.status,
          orderStatus: order.status,
          action: dto.action,
          failureReason: dto.failureReason,
          rescheduledDate: rescheduledDate,
          photoUrl: pod.photoUrl,
        },
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      await this.safeDeleteFile(file?.path);
      this.logger.error(`Lỗi khi xử lý thất bại cho điểm dừng ${stopId}:`, err);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
