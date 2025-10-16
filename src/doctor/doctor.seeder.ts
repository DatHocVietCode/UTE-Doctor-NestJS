import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Profile } from "src/profile/schema/profile.schema";
import { Doctor } from "./schema/doctor.schema";


@Injectable()
export class DoctorSeeder implements OnModuleInit {
  constructor(
    @InjectModel(Doctor.name) private readonly doctorModel: Model<Doctor>,
    @InjectModel(Profile.name) private readonly profileModel: Model<Profile>,
  ) {}

  async onModuleInit() {
    const SPECIALTIES = {
      CHAN_THUONG_CHINH_HINH: "68dd33fbb95fe8743a3c59b7",
      THAN_KINH: "68dd33fbb95fe8743a3c59b8",
      NOI_TONG_QUAT: "68dd33fbb95fe8743a3c59b9",
      HUYET_HOC_TRUYEN_MAU: "68dd33fbb95fe8743a3c59ba",
      NOI_TIET: "68dd33fbb95fe8743a3c59bb",
      HO_HAP: "68dd33fbb95fe8743a3c59bc",
      TIM_MACH: "68dd33fbb95fe8743a3c59bd",
      KHOA_NHI: "68dd33fbb95fe8743a3c59be",
      KHOA_DA_LIEU: "68dd33fbb95fe8743a3c59bf",
      SAN_PHU_KHOA: "68dd33fbb95fe8743a3c59c0",
    };

    const mockDoctors = [
      { name: "BS. Nguyễn Văn An", email: "an.nguyen@hospital.vn", chuyenKhoaId: SPECIALTIES.TIM_MACH },
      { name: "BS. Trần Thị Bình", email: "binh.tran@hospital.vn", chuyenKhoaId: SPECIALTIES.NOI_TIET },
      { name: "BS. Lê Minh Cường", email: "cuong.le@hospital.vn", chuyenKhoaId: SPECIALTIES.HO_HAP },
      { name: "BS. Phạm Thu Dung", email: "dung.pham@hospital.vn", chuyenKhoaId: SPECIALTIES.NOI_TONG_QUAT },
      { name: "BS. Hoàng Văn Em", email: "em.hoang@hospital.vn", chuyenKhoaId: SPECIALTIES.CHAN_THUONG_CHINH_HINH },
      { name: "BS. Võ Thị Phượng", email: "phuong.vo@hospital.vn", chuyenKhoaId: SPECIALTIES.KHOA_DA_LIEU },
      { name: "BS. Đặng Quốc Gia", email: "gia.dang@hospital.vn", chuyenKhoaId: SPECIALTIES.HUYET_HOC_TRUYEN_MAU },
      { name: "BS. Ngô Thị Hằng", email: "hang.ngo@hospital.vn", chuyenKhoaId: SPECIALTIES.KHOA_NHI },
      { name: "BS. Bùi Văn Hùng", email: "hung.bui@hospital.vn", chuyenKhoaId: SPECIALTIES.THAN_KINH },
      { name: "BS. Lý Thị Kim", email: "kim.ly@hospital.vn", chuyenKhoaId: SPECIALTIES.SAN_PHU_KHOA },
    ];

    for (const doc of mockDoctors) {
      const existProfile = await this.profileModel.findOne({ email: doc.email });
      if (existProfile) continue;

      // Tạo profile cơ bản cho bác sĩ
      const profile = await this.profileModel.create({
        name: doc.name,
        email: doc.email,
        gender: "Khác",
      });

      // Tạo doctor liên kết với profile và chuyên khoa
      await this.doctorModel.create({
        profileId: profile._id,
        chuyenKhoaId: doc.chuyenKhoaId,
        yearsOfExperience: Math.floor(Math.random() * 15) + 5,
        degree: ["BSCKI", "BSCKII"][Math.floor(Math.random() * 2)],
      });

      console.log(`✅ Seeded doctor: ${doc.name}`);
    }

    console.log("🎉 Done seeding doctors!");
  }
}
