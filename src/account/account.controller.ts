import { Body, Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { AccountService } from './account.service';
import { Account } from './schemas/account.schema';

@Controller('users')
export class UsersController {
    constructor(private readonly accountService: AccountService) {}

    @Get('by-email')
    findByEmail(@Query('email') email: string) {
        return this.accountService.getUserByEmail(email);
    }

    @Get()
    findAll() {
        return this.userService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.userService.findOne(id);
    }

    @Patch(':id')
    update(
        @Param('id') id: string,
        @Body() updateUserDto: Partial<User>,
    ) {
        return this.userService.update(id, updateUserDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.userService.remove(id);
    }


}
