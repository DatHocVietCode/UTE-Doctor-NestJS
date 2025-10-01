import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from 'src/xac-thuc/auth.module';
import { UsersController } from './account.controller';
import { UserService } from './account.service';
import { Account, AccountSchema } from './schemas/account.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Account.name, schema: AccountSchema }]),
    forwardRef(() => AuthModule), // dùng forwardRef để tránh circular dependency
  ],
  controllers: [UsersController],
  providers: [UserService],
  exports: [UserService]  // export UserService cho AuthModule inject
})
export class UsersModule {}
