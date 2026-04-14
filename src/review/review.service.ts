import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Review, ReviewDocument } from 'src/review/schema/review.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { AuthUser } from 'src/common/interfaces/auth-user';

@Injectable()
export class ReviewService {
  constructor(
    @InjectModel(Review.name)
    private reviewModel: Model<ReviewDocument>,
  ) {}

  async create(
    data: {
      doctorId: string;
      appointmentId: string;
      rating: number;
      comment?: string;
    },
    user: AuthUser,
  ): Promise<DataResponse<any>> {
    if (!user?.patientId) {
      throw new NotFoundException('Patient not found');
    }
    const created = await this.reviewModel.create({
      ...data,
      patientId: user.patientId,
    });

    return {
      code: rc.SUCCESS,
      message: 'Ðánh giá thành công',
      data: created,
    };
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
  ){

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.reviewModel
        .find()
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'doctorId',
          select: 'doctorName',
        })
        .populate({
          path: 'patientId',
          select: 'profileId',
          populate: {
            path: 'profileId',
            select: 'name',
          },
        })
        .exec(),

      this.reviewModel.countDocuments(),
    ]);

    return {
      code: rc.SUCCESS,
      message: 'L?y danh sách dánh giá thành công',
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }



  async findById(id: string): Promise<DataResponse<any>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid review ID');
    }

    const review = await this.reviewModel
      .findById(id)
      .populate('doctorId')
      .populate('patientId')
      .exec();

    if (!review) throw new NotFoundException('Không tìm th?y dánh giá');

    return {
      code: rc.SUCCESS,
      message: 'L?y dánh giá thành công',
      data: review,
    };
  }

  async findByDoctorId(doctorId: string): Promise<DataResponse<any>> {
    if (!Types.ObjectId.isValid(doctorId)) {
      throw new NotFoundException('Invalid doctor ID');
    }

    const result = await this.reviewModel
      .find({ doctorId })
      .populate('patientId')
      .exec();

    return {
      code: rc.SUCCESS,
      message: 'L?y dánh giá c?a bác si thành công',
      data: result,
    };
  }

  async update(id: string, updateData: Partial<Review>): Promise<DataResponse<any>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid review ID');
    }

    const updated = await this.reviewModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!updated) throw new NotFoundException('Không tìm th?y dánh giá');

    return {
      code: rc.SUCCESS,
      message: 'C?p nh?t dánh giá thành công',
      data: updated,
    };
  }

  async delete(id: string): Promise<DataResponse<any>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid review ID');
    }

    const deleted = await this.reviewModel.findByIdAndDelete(id);

    if (!deleted) throw new NotFoundException('Không tìm th?y dánh giá');

    return {
      code: rc.SUCCESS,
      message: 'Xóa dánh giá thành công',
      data: deleted,
    };
  }

  async findByAppointmentAndPatient(appointmentId: string, user: AuthUser) {
    const dataRes: DataResponse<any> = {
      code: rc.PENDING,
      message: '',
      data: null,
    };

    const patientId = user?.patientId;
    if (!patientId || !Types.ObjectId.isValid(appointmentId) || !Types.ObjectId.isValid(patientId)) {
      dataRes.code = rc.ERROR;
      dataRes.message = 'Giá tr? ID không h?p l?';
      return dataRes;
    }

    const review = await this.reviewModel
      .findOne({ appointmentId, patientId })
      // .populate('doctorId')
      // .populate('patientId')
      .exec();

    if (!review) {
      dataRes.code = rc.SUCCESS;
      dataRes.message = 'Không tìm th?y dánh giá cho cu?c h?n và b?nh nhân này';
      dataRes.data = null;
      return dataRes;
    }

    dataRes.code = rc.SUCCESS;
    dataRes.message = 'L?y dánh giá thành công';
    dataRes.data = review;
    return dataRes;
  }


}