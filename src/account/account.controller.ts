import { Body, Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { AccountService } from './account.service';
import { Account } from './schemas/account.schema';

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
