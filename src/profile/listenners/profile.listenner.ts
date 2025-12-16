import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { ProfileService } from "../profile.service";

@Injectable()
export class ProfileListener {
  constructor(private readonly profileService: ProfileService) {}

  @OnEvent('profile.update')
  async handleProfileUpdate(payload: { profileId: string; data: any }) {
    return this.profileService.handleProfileUpdate(payload);
  }
}
