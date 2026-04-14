import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { Types } from "mongoose";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { JwtAuthGuard } from "src/common/guards/jws-auth.guard";
import { AuthUser } from "src/common/interfaces/auth-user";
import { AppointmentBookingService } from "./appointment-booking.service";
import { AppointmentRescheduleService } from "./appointment-reschedule.service";
import { AppointmentService } from "./appointment.service";
import { AppointmentBookingDto, AppointmentBookingRequestDto, CompleteAppointmentDto } from "./dto/appointment-booking.dto";
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
        try {
            const result = await this.appointmentRescheduleService.rescheduleAppointment(
                {
                    ...dto,
                    appointmentId,
                },
            );
            return result;
        } catch (error: any) {
            throw new Error(`Failed to reschedule appointment: ${error.message}`);
        }
    }

    @Patch('/cancel')
    @UseGuards(JwtAuthGuard)
    async cancelAppointment(@Body() dto: { appointmentId: string; reason?: string }, @Req() req: any) {
        try {
            // Cancellation timing checks are centralized in the service against scheduledAt.
            const result = await this.appointmentService.cancelAppointment(
                dto.appointmentId,
                dto.reason
            );
            return result;
        } catch (error: any) {
            throw new Error(`Failed to cancel appointment: ${error.message}`);
        }
    }

    @Patch(':id/confirm')
    confirmAppointment(@Param('id') id: string) {
        return this.appointmentService.confirmAppointment(id);
    }


}
