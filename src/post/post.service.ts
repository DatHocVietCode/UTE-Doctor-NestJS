import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateDoctorPostDto } from './dto/create-doctor-post.dto';
import { UpdateDoctorPostDto } from './dto/update-doctor-post.dto';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { DoctorPost, DoctorPostDocument } from 'src/post/schema/post.schema';

@Injectable()
export class DoctorPostService {
  constructor(
    @InjectModel(DoctorPost.name)
    private readonly doctorPostModel: Model<DoctorPostDocument>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async create(dto: CreateDoctorPostDto, file: Express.Multer.File) {
    if (!file || !file.mimetype.startsWith('video/')) {
      throw new BadRequestException('File must be a video');
    }

    const postLink = await this.cloudinaryService.uploadVideoBuffer(
      file.buffer,
      file.mimetype,
      'doctor-videos',
    );

    const post = await this.doctorPostModel.create({
      ...dto,
      postLink,
    });

    return {
      status: true,
      message: 'Create doctor post successfully',
      data: post,
    };
  }

  async findAll(page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.doctorPostModel
        .find({ status: 'ACTIVE' })
        .populate('doctorId', 'doctorName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.doctorPostModel.countDocuments({ status: 'ACTIVE' }),
    ]);

    return {
      status: true,
      message: 'Get doctor posts successfully',
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async findOne(id: string) {
    const post = await this.doctorPostModel
      .findById(id)
      .populate('doctorId', 'name');

    if (!post) throw new NotFoundException('Post not found');

    return {
      status: true,
      message: 'Get doctor post detail successfully',
      data: post,
    };
  }

  async findByDoctor(doctorId: string, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.doctorPostModel
        .find({ doctorId})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.doctorPostModel.countDocuments({
        doctorId,
      }),
    ]);

    return {
      status: true,
      message: 'Get doctor posts by doctor successfully',
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async update(
    id: string,
    dto: UpdateDoctorPostDto,
    file?: Express.Multer.File,
  ) {
    const post = await this.doctorPostModel.findById(id);
    if (!post) throw new NotFoundException('Post not found');

    if (file) {
      if (!file.mimetype.startsWith('video/')) {
        throw new BadRequestException('File must be a video');
      }

      post.postLink = await this.cloudinaryService.uploadVideoBuffer(
        file.buffer,
        file.mimetype,
        'doctor-videos',
      );
    }

    Object.assign(post, dto);
    const updatedPost = await post.save();

    return {
      status: true,
      message: 'Update doctor post successfully',
      data: updatedPost,
    };
  }

  async remove(id: string) {
    const post = await this.doctorPostModel.findByIdAndDelete(id);
    if (!post) throw new NotFoundException('Post not found');

    return {
      status: true,
      message: 'Delete doctor post successfully',
      data: null,
    };
  }

  async increaseView(id: string) {
    const post = await this.doctorPostModel.findByIdAndUpdate(
      id,
      { $inc: { viewCount: 1 } },
      { new: true },
    );

    if (!post) throw new NotFoundException('Post not found');

    return {
      status: true,
      message: 'Increase view successfully',
      data: post,
    };
  }

  async updateStatus(
    id: string,
    status: 'ACTIVE' | 'HIDDEN',
  ) {
    const post = await this.doctorPostModel.findById(id);
    if (!post) throw new NotFoundException('Post not found');

    post.status = status;
    await post.save();

    return {
      status: true,
      message: `Update post status to ${status} successfully`,
      data: post,
    };
  }

}
