import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from 'src/account/schemas/account.schema';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';

@Injectable()
export class ChatSearchService {
  constructor(
    @InjectModel(Account.name) private readonly accountModel: Model<AccountDocument>,
    @InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>,
  ) {}

  async searchContacts(params: { q?: string; role?: string; limit?: number }) {
    const limit = Math.min(params.limit ?? 10, 25);
    const q = params.q?.trim();
    const regex = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;

    const accountFilter: any = {};
    if (params.role) accountFilter.role = params.role;
    if (regex) accountFilter.email = regex;

    const accounts = await this.accountModel.find(accountFilter).limit(limit).lean();

    const profileFilter: any = regex ? { name: regex } : {};
    const profiles = await this.profileModel.find(profileFilter).limit(limit).lean();

    const profileIds = profiles.map((p: any) => p._id);
    const accountsByProfile = profileIds.length
      ? await this.accountModel.find({ profileId: { $in: profileIds }, ...(params.role ? { role: params.role } : {}) }).lean()
      : [];

    const byId: Record<string, any> = {};
    [...accounts, ...accountsByProfile].forEach((a: any) => { byId[String(a._id)] = a; });
    const allAccounts = Object.values(byId) as any[];

    const profileMap = new Map<string, any>(profiles.map((p: any) => [String(p._id), p]));
    return allAccounts.slice(0, limit).map((a: any) => {
      const prof = a.profileId ? profileMap.get(String(a.profileId)) : null;
      return {
        accountId: String(a._id),
        email: a.email,
        role: a.role,
        displayName: prof?.name || a.email,
        avatarUrl: prof?.avatarUrl || null,
        profileId: a.profileId ? String(a.profileId) : null,
      };
    });
  }
}
