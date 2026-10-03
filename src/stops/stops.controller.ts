import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StopsService } from './stops.service';
import { SubmitPodDto } from './dto/submit-pod.dto';
import { FailStopDto } from './dto/fail-stop.dto';
import { podMulterOptions } from './config/pod-multer.config';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../entities/user.entity';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('stops')
export class StopsController {
  constructor(private readonly stopsService: StopsService) {}

  /**
   * KLTN-84: Ghi nhận mốc thời gian arrived_at khi tài xế có mặt tại điểm giao
   * PATCH /api/stops/:id/arrived
   */
  @Patch(':id/arrived')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DRIVER, UserRole.DISPATCHER, UserRole.ADMIN)
  markArrived(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.stopsService.markArrived(id, user);
  }

  /**
   * KLTN-85: Upload ảnh chụp kiện hàng thực tế, lưu POD, đổi trạng thái đơn sang DELIVERED, cộng dồn COD
   * POST /api/stops/:id/pod
   */
  @Post(':id/pod')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DRIVER, UserRole.DISPATCHER, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file', podMulterOptions))
  submitPod(
    @Param('id') id: string,
    @Body() dto: SubmitPodDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stopsService.submitPod(id, dto, file, user);
  }

  /**
   * KLTN-86: Ghi nhận lý do thất bại, lưu ảnh minh chứng, đổi trạng thái đơn sang FAILED hoặc RESCHEDULED
   * POST /api/stops/:id/fail
   */
  @Post(':id/fail')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DRIVER, UserRole.DISPATCHER, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file', podMulterOptions))
  failStop(
    @Param('id') id: string,
    @Body() dto: FailStopDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stopsService.failStop(id, dto, file, user);
  }
}
