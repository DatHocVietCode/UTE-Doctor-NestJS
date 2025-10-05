import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Profile, ProfileSchema } from "./schema/profile.schema";
import { ProfileService } from "./profile.service";

@Module({
  imports: [MongooseModule.forFeature([{ name: Profile.name, schema: ProfileSchema }])],
  providers: [ProfileService],
  exports: [ProfileService], // để Doctor/Patient service dùng
})
export class ProfileModule {}
