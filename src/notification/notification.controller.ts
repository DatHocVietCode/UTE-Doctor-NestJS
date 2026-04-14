import {
    Controller,
    Get,
    Param,
    Patch,
    Query,
    Req,
    UnauthorizedException,
    UseGuards,
} from "@nestjs/common";
import { DataResponse } from "src/common/dto/data-respone";
import { GetNotificationsQueryDto } from "src/common/dto/get-notification-query.dto";
import { PaginationQueryDto } from "src/common/dto/pagination-query.dto";
import { PaginationResult } from "src/common/dto/pagination-result.dto";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { JwtAuthGuard } from "src/common/guards/jws-auth.guard";
import { NotificationService } from "./notification.service";
import { Notification } from "./schemas/notification.schema";

@Controller('/notifications')
export class NotificationController {

    constructor(private readonly notificationService: NotificationService) {}

    @Get()
    async getNotifications(
            @Query() pagination: PaginationQueryDto
        ): Promise<DataResponse<PaginationResult<Notification>>> {
        const result = await this.notificationService.getNotifications(pagination);

        return {
            code: ResponseCode.SUCCESS,
            message: 'Notifications fetched successfully',
            data: result,
        };
    }

    @UseGuards(JwtAuthGuard)
    @Get('/by-email')
    async getNotificationsByEmail(
        @Req() req: any,
        @Query() query: GetNotificationsQueryDto,
        ): Promise<DataResponse<PaginationResult<Notification>>> {

        const email = (req.user as { email?: string } | undefined)?.email;

        if (!email) {
            throw new UnauthorizedException('Unable to determine user email');
        }

        const result = await this.notificationService.getNotificationsByEmail(
            email,
            { page: query.page, limit: query.limit }
        );

        return {
            code: ResponseCode.SUCCESS,
            message: 'Notifications fetched successfully',
            data: result,
        };
    }
    
    @UseGuards(JwtAuthGuard)
    @Get('count')
    async getUnreadCount(@Req() req: any): Promise<DataResponse<number>> {
        const email = (req.user as { email?: string } | undefined)?.email;
        if (!email) {
            throw new UnauthorizedException('Unable to determine user email');
        }
        const count = await this.notificationService.countUnreadByEmail(email);
        return {
            code: ResponseCode.SUCCESS,
            message: 'Unread notifications count fetched successfully',
            data: count,
        };
    }

    @Patch(':id/read')
    @UseGuards(JwtAuthGuard)
    async markAsRead(@Param('id') id: string): Promise<DataResponse<Notification>> {
        const notif = await this.notificationService.markAsRead(id);
        return {
            code: ResponseCode.SUCCESS,
            message: 'Notification marked as read',
            data: notif,
        };
    }
}

