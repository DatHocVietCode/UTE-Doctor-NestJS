import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { RoleEnum } from 'src/common/enum/role.enum';
import { Patient } from 'src/patient/schema/patient.schema';
import { Doctor } from 'src/doctor/schema/doctor.schema';
import { CreatePatientDto } from 'src/patient/dto/create-patient.dto';
import { CreateDoctorDto } from 'src/doctor/dto/create-doctor.dto';
import { CreateProfileDto } from 'src/profile/dto/create-profile.dto';

@Injectable()
export class AuthSaga {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  @OnEvent('user.register.requested')
  async handleRegister(payload: any) {
    const { registerUser } = payload;
    console.log('[Saga]: Start registration for', registerUser.email);

    const [createdAccountRes] = await this.eventEmitter.emitAsync(
      'account.createAccount',
      registerUser,
    );
    if (createdAccountRes.code === rc.ERROR) {
      this.eventEmitter.emit('user.register.failed', { dto: registerUser, dataResponse: createdAccountRes });
      console.log('[Saga]: ❌ Account creation failed');
      return;
    }

    const accountId = createdAccountRes.data!._id.toString();
    console.log('[Saga]: ✅ Account created →', accountId);

    const createProfileDto: CreateProfileDto = {
      name: registerUser.fullName,
      gender: registerUser.gender,
      dob: registerUser.dob,
      phone: registerUser.phone,
      address: registerUser.address,
      email: registerUser.email,
    };

    const [createdProfileRes] = await this.eventEmitter.emitAsync(
      'profile.createProfile',
      createProfileDto,
    );

    if (createdProfileRes.code === rc.ERROR) {
      await this.eventEmitter.emitAsync('account.deleteAccount', registerUser.email);
      this.eventEmitter.emit('user.register.failed', { dto: registerUser, dataResponse: createdProfileRes });
      return;
    }

    const profileId = createdProfileRes.data!._id.toString();
    console.log('[Saga]: Profile created →', profileId);

    const [linkAccountRes] = await this.eventEmitter.emitAsync('account.linkProfile', {
      accountId,
      profileId,
    });
    if (linkAccountRes.code === rc.ERROR) {
      console.log('[Saga]: Failed to link profile to account → rolling back...');
      await Promise.all([
        this.eventEmitter.emitAsync('profile.deleteProfile', profileId),
        this.eventEmitter.emitAsync('account.deleteAccount', registerUser.email),
      ]);
      this.eventEmitter.emit('user.register.failed', { dto: registerUser, dataResponse: linkAccountRes });
      return;
    }

    console.log('[Saga]: 🔗 Linked Profile to Account');

    let childEntityResult: DataResponse<any> | undefined;
    console.log(registerUser.role)
    if (registerUser.role === RoleEnum.PATIENT) {
      const createdPatientDto: CreatePatientDto = {
        profileId,
        height: registerUser.medicalRecord?.height,
        weight: registerUser.medicalRecord?.weight,
        bloodType: registerUser.medicalRecord?.bloodType,
        medicalRecord: registerUser.medicalRecord,
      };

      const [res] = await this.eventEmitter.emitAsync('patient.createPatient', createdPatientDto);
      console.log("This is res from patient:", res)
      childEntityResult = res as DataResponse<Patient>;
    } else if (registerUser.role === RoleEnum.DOCTOR) {
      const createdDoctorDto: CreateDoctorDto = {
        profileId,
        chuyenKhoaId: registerUser.chuyenKhoaId,
        degree: registerUser.degree,
        yearsOfExperience: registerUser.yearsOfExperience,
    };

      const [res] = await this.eventEmitter.emitAsync('doctor.createDoctor', createdDoctorDto);
      childEntityResult = res as DataResponse<Doctor>;
    }
    
    console.log(childEntityResult)

    if (!childEntityResult || childEntityResult.code === rc.ERROR) {
      console.log('[Saga]: ❌ Failed to create child entity → rolling back...');
      await Promise.all([
        this.eventEmitter.emitAsync('profile.deleteProfile', profileId),
        this.eventEmitter.emitAsync('account.deleteAccount', registerUser.email),
      ]);
      this.eventEmitter.emit('user.register.failed', { dto: registerUser, error: childEntityResult?.message });
      return;
    }

    const childId = childEntityResult.data!._id.toString();
    console.log(`[Saga]: ✅ ${registerUser.role} created → ${childId}`);

    this.eventEmitter.emit('user.register.success', {
      registerUser,
      account: { id: accountId, email: registerUser.email },
      profile: { id: profileId },
    });

    this.eventEmitter.emit('handle-otp.send', registerUser.email);
    console.log('[Saga]: 🎉 Registration completed successfully');
  }
}
