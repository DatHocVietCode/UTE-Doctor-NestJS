import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { Types } from "mongoose";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { RoleEnum } from "src/common/enum/role.enum";
import { JwtAuthGuard } from "src/common/guards/jws-auth.guard";
import { RoleGuard } from "src/common/guards/role.guard";
import { Roles } from "src/common/guards/roles.decorator";
import { AuthUser } from "src/common/interfaces/auth-user";
import { AppointmentBookingService } from "./appointment-booking.service";
import { AppointmentRescheduleService } from "./appointment-reschedule.service";
import { AppointmentService } from "./appointment.service";
import { CancellationActor } from "./enums/cancellation-actor.enum";
import { NoShowSource } from "./enums/no-show-source.enum";
import { AppointmentBookingDto, AppointmentBookingRequestDto, CompleteAppointmentDto } from "./dto/appointment-booking.dto";
import { AppointmentCancelDto } from './dto/appointment-cancel.dto';
import { AppointmentRescheduleDto } from './dto/appointment-reschedule.dto';

@Controller('appointment')
export class AppointmentController {
    constructor(
        private readonly appointmentService: AppointmentService,
        private readonly appointmentBookingService: AppointmentBookingService,
        private readonly appointmentRescheduleService: AppointmentRescheduleService,
    ) {}

    @Get('completed/doctor')
    @UseGuards(JwtAuthGuard)
        getCompletedAppointmentsByDoctor(
        @Req() req: any,
        @Query('page') page = 1,
        @Query('limit') limit = 10,
        @Query('keyword') keyword?: string,
        ) {
        const user = req.user as AuthUser;
        if (!user?.doctorId) {
            throw new UnauthorizedException('Unable to identify doctor from token');
        }
        return this.appointmentService.findCompletedByDoctor(
            user,
            Number(page),
            Number(limit),
            keyword,
        );
    }

    @Get('admin')
    async getAppointments(@Query() query: any) {
        return this.appointmentService.findAll(query);
    }

    @Get()
    async getAllAppointments() {
        return await this.appointmentService.getAllAppointments();
    }

    @Get('/patient')
    @UseGuards(JwtAuthGuard)
    async getAppointmentsByPatient(
    @Req() req: any,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
    ) {
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, Math.min(50, parseInt(limit) || 10));

        const user = req.user as AuthUser;
        const data = await this.appointmentService.getAppointmentsByPatient(
            user,
            pageNum,
            limitNum
        );

        return {
        code: ResponseCode.SUCCESS,
        message: "Fetched appointments successfully",
        data,
        };
    }


    @Post('/book')
    @UseGuards(JwtAuthGuard)
    async bookAppointment(@Req() req: any, @Body() bookingAppointment: AppointmentBookingRequestDto) {
        const user = req.user as AuthUser;
        if (!user?.email || !user?.accountId) {
            console.warn('User information missing in token:', user);
            throw new UnauthorizedException('Unable to identify user from token');
        }
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const payload: AppointmentBookingDto = {
            ...bookingAppointment,
            patientEmail: user.email,
            patientId: user.patientId!,
        };
        console.log('Received appointment booking:', payload);
        return await this.appointmentBookingService.bookAppointment(payload, clientIp as string);
    }

    @Get('/today')
    @UseGuards(JwtAuthGuard)
    async getTodayAppointments(@Req() req: any) {
        const user = req.user as AuthUser;
        if (!user?.doctorId) {
            throw new UnauthorizedException('Unable to identify doctor from token');
        }
        console.log(`[AppointmentController] GET /today?doctorId=${user.doctorId}`);
        try {
            const res = await this.appointmentService.getTodayAppointments(user);
            console.log('[AppointmentController] Response data:', JSON.stringify(res?.data ?? res));
            return res;
        } catch (error: any) {
            console.error('[AppointmentController] Error in getTodayAppointments:', error?.message ?? error);
            throw error;
        }
    }

    @Patch('/complete')
    async completeAppointment(@Body() dto: CompleteAppointmentDto) {
        return await this.appointmentService.completeAppointment(dto);
  }

    @Get(':appointmentId/deposit-status')
    @UseGuards(JwtAuthGuard)
    async getDepositStatus(@Param('appointmentId') appointmentId: string, @Req() req: any) {
        // Polling is read-only; authorization is enforced against the linked appointment owner.
        return this.appointmentService.getDepositStatus(appointmentId, req.user as AuthUser);
    }

  @Get(':id')
    async getAppointmentById(@Param('id') id: string) {
        // Validate ObjectId
        if (!Types.ObjectId.isValid(id)) {
        throw new NotFoundException('Invalid appointment ID');
        }

        const appointment = await this.appointmentService.findById(id);

        if (!appointment) {
        throw new NotFoundException('Appointment not found');
        }

        return appointment;
    }
    @Patch(':id/reschedule')
    @UseGuards(JwtAuthGuard)
    async rescheduleAppointment(
        @Param('id') appointmentId: string,
        @Body() dto: AppointmentRescheduleDto,
        @Req() req: any,
    ) {
        const user = req.user as AuthUser;
        // Pass JWT identity for audit logging; do not allow the caller to supply rescheduledBy.
        return this.appointmentRescheduleService.rescheduleAppointment({
            ...dto,
            appointmentId,
            rescheduledBy: user?.email ?? user?.accountId ?? undefined,
        });
    }

    @Patch('/cancel')
    @UseGuards(JwtAuthGuard)
    async cancelAppointment(@Body() dto: AppointmentCancelDto, @Req() req: any) {
        // Cancellation timing and visit lifecycle checks are centralized in the service.
        return this.appointmentService.cancelAppointment(
            dto.appointmentId,
            dto.reason,
            req.user as AuthUser,
        );
    }

    @Patch(':id/confirm')
    confirmAppointment(@Param('id') id: string) {
        return this.appointmentService.confirmAppointment(id);
    }

    // Manual staff fallback for clearing an obvious no-show before the next reconciler run.
    // Thin: all eligibility/idempotency lives in the shared markAppointmentNoShow core.
    @Patch(':appointmentId/no-show')
    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles(RoleEnum.RECEPTIONIST, RoleEnum.ADMIN)
    async markNoShow(@Param('appointmentId') appointmentId: string, @Req() req: any) {
        const user = req.user as AuthUser;
        const result = await this.appointmentService.markAppointmentNoShow({
            appointmentId,
            actor: CancellationActor.STAFF,
            source: NoShowSource.MANUAL,
            markedByAccountId: user?.accountId,
        });
        return {
            code: result.noShow || result.alreadyNoShow ? ResponseCode.SUCCESS : ResponseCode.ERROR,
            message: result.alreadyNoShow
                ? 'Appointment already marked as no-show'
                : result.noShow
                  ? 'Appointment marked as no-show'
                  : `Appointment not eligible for no-show: ${result.reason ?? 'unknown'}`,
            data: result,
        };
    }


}
