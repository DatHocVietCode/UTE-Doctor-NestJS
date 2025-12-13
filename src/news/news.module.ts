import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { News, NewsSchema } from 'src/news/schemas/news.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: News.name, schema: NewsSchema },
    ]),
  ],
  controllers: [NewsController],
  providers: [NewsService, CloudinaryService],
  exports: [NewsService],
})
export class NewsModule {}
