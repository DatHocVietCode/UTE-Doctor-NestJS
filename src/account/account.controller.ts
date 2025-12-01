import { Body, Controller, Delete, Get, Param, Patch, Put, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { AccountService } from './account.service';
import { AccountProfileDto } from './dto/account.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Account } from './schemas/account.schema';

@Controller('users')
export class AccountController {
    constructor(private readonly accountService: AccountService, private readonly cloudinaryService: CloudinaryService) {}

    // @Get('by-email')
    // findByEmail(@Query('email') email: string) {
    //     return this.accountService.getUserByEmail(email);
    // }

    @Get()
    findAll() {
        return this.accountService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.accountService.findOne(id);
    }

    @Put('profile')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(FileInterceptor('avatar', { storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
    async updateProfile(
        @Req() req: any,
        @Body() updateProfileDto: Partial<AccountProfileDto>,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        // If file uploaded, upload it to Cloudinary and set avatarUrl
        if (file && file.buffer) {
            try {
                const url = await this.cloudinaryService.uploadFileBuffer(file.buffer, file.mimetype, 'profiles');
                updateProfileDto.avatarUrl = url;
            } catch (error) {
                console.error('Failed to upload avatar in controller', error);
                // proceed without failing the request; AccountService will also attempt base64 upload if needed
            }
        }

        return this.accountService.updateUserProfile(req.user.id, updateProfileDto);
    }

    @Put('password')
    @UseGuards(JwtAuthGuard)
    async changePassword(
        @Req() req: any,
        @Body() body: ChangePasswordDto
    ) {
        return this.accountService.changePassword(req.user.id, body.currentPassword, body.newPassword);
    }

    @Patch(':id')
    update(
        @Param('id') id: string,
        @Body() updateUserDto: Partial<Account>,
    ) {
        return this.accountService.update(id, updateUserDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.accountService.remove(id);
    }


}
