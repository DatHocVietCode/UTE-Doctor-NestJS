import { Body, Controller, Delete, Get, Param, Patch, Put, Query, UseGuards, Req } from '@nestjs/common';
import { AccountService } from './account.service';
import { Account } from './schemas/account.schema';
import { AccountProfileDto } from './dto/account.dto';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';

@Controller('users')
export class AccountController {
    constructor(private readonly accountService: AccountService) {}

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
    async updateProfile(
        @Req() req: any,
        @Body() updateProfileDto: Partial<AccountProfileDto>,
    ) {
        return this.accountService.updateUserProfile(req.user.id, updateProfileDto);
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
