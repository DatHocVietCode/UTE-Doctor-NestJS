import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Review, ReviewDocument } from 'src/review/schema/review.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';

@Injectable()
export class ReviewService {
  constructor(
    @InjectModel(Review.name)
    private reviewModel: Model<ReviewDocument>,
  ) {}

  async create(data: {
    doctorId: string;
    patientId: string;
    appointmentId: string;
    rating: number;
    comment?: string;
  }): Promise<DataResponse<any>> {
    const created = await this.reviewModel.create(data);

    return {
      code: rc.SUCCESS,
      message: 'Đánh giá thành công',
      data: created,
    };
  }

  async findAll(): Promise<DataResponse<any>> {
    const result = await this.reviewModel
      .find()
      .populate('doctorId')
      .populate('patientId')
      .exec();

    return {
      code: rc.SUCCESS,
      message: 'Lấy tất cả đánh giá thành công',
      data: result,
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

    if (!review) throw new NotFoundException('Không tìm thấy đánh giá');

    return {
      code: rc.SUCCESS,
      message: 'Lấy đánh giá thành công',
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
      message: 'Lấy đánh giá của bác sĩ thành công',
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

    if (!updated) throw new NotFoundException('Không tìm thấy đánh giá');

    return {
      code: rc.SUCCESS,
      message: 'Cập nhật đánh giá thành công',
      data: updated,
    };
  }

  async delete(id: string): Promise<DataResponse<any>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid review ID');
    }

    const deleted = await this.reviewModel.findByIdAndDelete(id);

    if (!deleted) throw new NotFoundException('Không tìm thấy đánh giá');

    return {
      code: rc.SUCCESS,
      message: 'Xóa đánh giá thành công',
      data: deleted,
    };
  }

  async findByAppointmentAndPatient(appointmentId: string, patientId: string) {
    const dataRes: DataResponse<any> = {
      code: rc.PENDING,
      message: '',
      data: null,
    };

    if (!Types.ObjectId.isValid(appointmentId) || !Types.ObjectId.isValid(patientId)) {
      dataRes.code = rc.ERROR;
      dataRes.message = 'Giá trị ID không hợp lệ';
      return dataRes;
    }

    const review = await this.reviewModel
      .findOne({ appointmentId, patientId })
      // .populate('doctorId')
      // .populate('patientId')
      .exec();

    if (!review) {
      dataRes.code = rc.SUCCESS;
      dataRes.message = 'Không tìm thấy đánh giá cho cuộc hẹn và bệnh nhân này';
      dataRes.data = null;
      return dataRes;
    }

    dataRes.code = rc.SUCCESS;
    dataRes.message = 'Lấy đánh giá thành công';
    dataRes.data = review;
    return dataRes;
  }


}
