import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Review, ReviewDocument } from 'src/review/schema/review.schema';

@Injectable()
export class ReviewService {
  constructor(
    @InjectModel(Review.name)
    private reviewModel: Model<ReviewDocument>,
  ) {}

  async create(data: {
    doctorId: string;
    patientId: string;
    rating: number;
    note?: string;
  }) {
    return this.reviewModel.create(data);
  }

  async findAll() {
    return this.reviewModel
      .find()
      .populate('doctorId')
      .populate('patientId')
      .exec();
  }

  async findById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid review ID');
    }

    const review = await this.reviewModel
      .findById(id)
      .populate('doctorId')
      .populate('patientId')
      .exec();

    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  async findByDoctorId(doctorId: string) {
    if (!Types.ObjectId.isValid(doctorId)) {
      throw new NotFoundException('Invalid doctor ID');
    }

    return this.reviewModel
      .find({ doctorId })
      .populate('patientId')
      .exec();
  }

  async update(id: string, updateData: Partial<Review>) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid review ID');
    }

    const updated = await this.reviewModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!updated) throw new NotFoundException('Review not found');
    return updated;
  }

  async delete(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid review ID');
    }

    const deleted = await this.reviewModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('Review not found');
    return deleted;
  }
}
