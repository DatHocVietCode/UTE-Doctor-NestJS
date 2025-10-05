import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { AccountService } from 'src/account/account.service';
import { CreatePatientDto } from 'src/patient/dto/create-patient.dto';
import { PatientService } from 'src/patient/patient.service';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { DataResponse } from 'src/common/dto/data-respone';
import { Account } from 'src/account/schemas/account.schema';
import { Patient } from 'src/patient/schema/patient.schema';
import { CreateDoctorDto } from 'src/doctor/dto/create-doctor.dto';
import { Doctor } from 'src/doctor/schema/doctor.schema';
import { RoleEnum } from 'src/common/enum/role.enum';

@Injectable()
export class AuthSaga {

  constructor(private readonly eventEmitter: EventEmitter2,
  ) {}

  // nghe event từ AuthService
  @OnEvent('user.register.requested')
  async handleRegister(payload: any) {
    const { requestId, registerUser } = payload;

    console.log('[Saga]: Start registration for', registerUser.email);

    // 1️⃣ Tạo Account
    const createdAccountResults = await this.eventEmitter.emitAsync('account.createAccount', registerUser);
    const createdAccountRes = createdAccountResults[0] as DataResponse<Account>;

    if (createdAccountRes.code === rc.ERROR) {
      this.eventEmitter.emit('user.register.failed', {
        requestId,
        dto: registerUser,
        dataResponse: createdAccountRes,
      });
      console.log('[Saga]: Account creation failed →', createdAccountRes.message);
      return;
    }

    const newAccountId = createdAccountRes.data!._id.toString();
    console.log('[Saga]: Account created successfully →', newAccountId);

    // 2️⃣ Tạo thực thể phụ thuộc (Patient / Doctor)
    let childEntityResult: DataResponse<any> | undefined;

    if (registerUser.role === RoleEnum.PATIENT) {
      const createdPatientDto: CreatePatientDto = {
        accountId: newAccountId,
        height: registerUser.medicalRecord?.height,
        weight: registerUser.medicalRecord?.weight,
        bloodType: registerUser.medicalRecord?.bloodType,
        medicalRecord: registerUser.medicalRecord,
      };

      const createdPatientResults = await this.eventEmitter.emitAsync('patient.createPatient', createdPatientDto);
      childEntityResult = createdPatientResults[0] as DataResponse<Patient>;

    } else if (registerUser.role === RoleEnum.DOCTOR) {
      const createdDoctorDto: CreateDoctorDto = {
        accountId: newAccountId,
        chuyenKhoaId: registerUser.chuyenKhoaId,
        degree: registerUser.degree,
        yearsOfExperience: registerUser.yearsOfExperience,
      };

      const createdDoctorResults = await this.eventEmitter.emitAsync('doctor.createDoctor', createdDoctorDto);
      childEntityResult = createdDoctorResults[0] as DataResponse<Doctor>;
    }

    // 3️⃣ Check lỗi khi tạo Doctor/Patient
    if (!childEntityResult || childEntityResult.code === rc.ERROR) {
      console.log('[Saga]: Failed to create child entity, rolling back...');
      await this.eventEmitter.emitAsync('account.deleteAccount', registerUser.email);

      this.eventEmitter.emit('user.register.failed', {
        requestId,
        dto: registerUser,
        error: childEntityResult?.message || 'Unknown error creating child entity',
      });
      return;
    }

    console.log('[Saga]: Child entity created successfully');

    // 4️⃣ Thành công → gửi event success
    this.eventEmitter.emit('user.register.success', {
      requestId,
      registerUser,
      account: { id: newAccountId, email: registerUser.email },
    });

    // 5️⃣ Gửi OTP xác thực
    this.eventEmitter.emit('otp.send', registerUser.email);
    console.log('[Saga]: Registration completed successfully');
  }

}
