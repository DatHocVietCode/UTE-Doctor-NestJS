import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Account } from './schemas/account.schema';
import { Profile } from 'src/profile/schema/profile.schema';

@Injectable()
export class AccountSeeder implements OnModuleInit {
  constructor(
    @InjectModel(Account.name) private readonly accountModel: Model<Account>,
    @InjectModel(Profile.name) private readonly profileModel: Model<Profile>,
  ) {}

  async onModuleInit() {
    try {
      const adminEmail = 'admin@gmail.com';
      const adminPasswordEnv = 'admin';

      const existing = await this.accountModel.findOne({ email: adminEmail }).lean();
      if (existing) {
        // ensure admin is active
        await this.accountModel.updateOne({ email: adminEmail }, { status: 'ACTIVE' }).exec();
        console.log('[AccountSeeder] Admin account exists — ensured status ACTIVE');
        return;
      }

      // create profile for admin
      const profile = await this.profileModel.create({
        name: 'Administrator',
        email: adminEmail,
      } as any);

      // generate password
      const rawPassword = adminPasswordEnv ?? require('crypto').randomBytes(6).toString('hex');
      const hashed = await bcrypt.hash(rawPassword, 10);

      await this.accountModel.create({
        email: adminEmail,
        password: hashed,
        role: 'ADMIN',
        profileId: profile._id,
        status: 'ACTIVE',
      } as any);

      console.log(`[AccountSeeder] Seeded admin account: ${adminEmail} (password: ${rawPassword})`);
    } catch (err) {
      console.error('[AccountSeeder] Failed to seed admin account:', err.message);
    }
  }
}
