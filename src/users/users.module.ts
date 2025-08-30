import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UserService } from './user.service';
import { UsersController } from './users.controller';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    forwardRef(() => AuthModule), // dùng forwardRef để tránh circular dependency
  ],
  controllers: [UsersController],
  providers: [UserService],
  exports: [UserService]  // export UserService cho AuthModule inject
})
export class UsersModule {}
