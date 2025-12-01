import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { Account, AccountSchema } from './schemas/account.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Account.name, schema: AccountSchema }]),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN }
    }),
    CloudinaryModule,
  ],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService]
})
export class AccountModule {}
