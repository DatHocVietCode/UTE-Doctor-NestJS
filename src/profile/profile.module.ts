import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Profile, ProfileSchema } from "./schema/profile.schema";
import { ProfileService } from "./profile.service";
import { ProfileSaga } from "./saga/profile.saga";
import { ProfileController } from "src/profile/profile.controller";

@Module({
  imports: [MongooseModule.forFeature([{ name: Profile.name, schema: ProfileSchema }])],
  providers: [ProfileService, ProfileSaga],
  controllers: [ProfileController],
  exports: [ProfileService], // để Doctor/Patient service dùng
})
export class ProfileModule {}
