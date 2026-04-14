import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { Account, AccountSchema } from './schemas/account.schema';
import { AccountSeeder } from './account.seeder';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Account.name, schema: AccountSchema },
      { name: Profile.name, schema: ProfileSchema },
    ]),
    CloudinaryModule,
  ],
  controllers: [AccountController],
  providers: [AccountService, AccountSeeder],
  exports: [AccountService]
})
export class AccountModule {}
