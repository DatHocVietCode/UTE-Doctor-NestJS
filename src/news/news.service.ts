import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateNewsDto } from './dto/create-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { News, NewsDocument } from 'src/news/schemas/news.schema';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';

@Injectable()
export class NewsService {
  constructor(
    @InjectModel(News.name) private newsModel: Model<NewsDocument>,
    private cloudinaryService: CloudinaryService,
  ) {}

  async create(
    dto: CreateNewsDto,
    file?: Express.Multer.File,
  ) {
    let imageUrl = '';


    if (file) {
      imageUrl = await this.cloudinaryService.uploadFileBuffer(
        file.buffer,
        file.mimetype,
        'news',
      );
    }

    const news = await this.newsModel.create({
      ...dto,
      imageUrl,
    });

    return {
      code: rc.SUCCESS,
      message: 'Tạo tin tức thành công',
      data: news,
    };
  }

  async findAll() {
    const data = await this.newsModel.find().sort({ createdAt: -1 });

    return {
      code: rc.SUCCESS,
      message: 'Lấy danh sách tin tức thành công',
      data,
    };
  }

  async findOne(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid news ID');
    }

    const news = await this.newsModel.findById(id);
    if (!news) throw new NotFoundException('Không tìm thấy tin tức');

    return {
      code: rc.SUCCESS,
      message: 'Lấy chi tiết tin tức thành công',
      data: news,
    };
  }

  async update(
    id: string,
    dto: UpdateNewsDto,
    file?: Express.Multer.File,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid news ID');
    }

    const updateData: any = { ...dto };

    if (file) {
      updateData.imageUrl = await this.cloudinaryService.uploadFileBuffer(
        file.buffer,
        file.mimetype,
        'news',
      );
    }

    const news = await this.newsModel.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    if (!news) throw new NotFoundException('Không tìm thấy tin tức');

    return {
      code: rc.SUCCESS,
      message: 'Cập nhật tin tức thành công',
      data: news,
    };
  }

  async delete(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid news ID');
    }

    const deleted = await this.newsModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('Không tìm thấy tin tức');

    return {
      code: rc.SUCCESS,
      message: 'Xóa tin tức thành công',
      data: deleted,
    };
  }

  async findPublic() {
    const now = new Date();

    const data = await this.newsModel
        .find({
        isActive: true,
        startDate: { $lte: now },
        endDate: { $gte: now },
        })
        .sort({ startDate: -1 })
        .select('title imageUrl content startDate endDate')
        .lean();

    return {
        code: rc.SUCCESS,
        message: 'Lấy danh sách tin tức công khai thành công',
        data,
    };
    }

}
