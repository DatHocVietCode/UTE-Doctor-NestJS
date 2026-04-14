import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { CloudinaryService } from "src/cloudinary/cloudinary.service";
import { DoctorPostController } from "src/post/post.controller";
import { DoctorPostService } from "src/post/post.service";
import { DoctorPost, DoctorPostSchema } from "src/post/schema/post.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DoctorPost.name, schema: DoctorPostSchema },
    ]),
  ],
  controllers: [DoctorPostController],
  providers: [DoctorPostService, CloudinaryService],
})
export class DoctorPostModule {}
