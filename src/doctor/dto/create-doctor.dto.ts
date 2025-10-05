export class CreateDoctorDto {

  accountId: string;   // liên kết tới Account

  chuyenKhoaId: string; // liên kết tới chuyên khoa

  degree?: string;

  yearsOfExperience?: number;
}
