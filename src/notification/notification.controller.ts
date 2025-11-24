import { Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { DataResponse } from "src/common/dto/data-respone";
import { GetNotificationsQueryDto } from "src/common/dto/get-notification-query.dto";
import { PaginationQueryDto } from "src/common/dto/pagination-query.dto";
import { PaginationResult } from "src/common/dto/pagination-result.dto";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
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

    @Get('/by-email')
    async getNotificationsByEmail(
        @Query() query: GetNotificationsQueryDto,
        ): Promise<DataResponse<PaginationResult<Notification>>> {

        const { page, limit, email } = query;

        const result = await this.notificationService.getNotificationsByEmail(
            email,
            { page, limit }
        );

        return {
            code: ResponseCode.SUCCESS,
            message: 'Notifications fetched successfully',
            data: result,
        };
    }
   @Get('count')
    async getUnreadCount(@Query('email') email: string): Promise<DataResponse<number>> {
        const count = await this.notificationService.countUnreadByEmail(email);
        return {
        code: ResponseCode.SUCCESS,
        message: 'Unread notifications count fetched successfully',
        data: count,
        };
    }

    @Patch(':id/read')
    async markAsRead(@Param('id') id: string): Promise<DataResponse<Notification>> {
    const notif = await this.notificationService.markAsRead(id);
    return {
        code: ResponseCode.SUCCESS,
        message: 'Notification marked as read',
        data: notif,
    };
    }
}