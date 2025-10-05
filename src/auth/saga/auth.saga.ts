import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { AccountService } from 'src/account/account.service';
import { CreatePatientDto } from 'src/patient/dto/create-patient.dto';
import { PatientService } from 'src/patient/patient.service';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { DataResponse } from 'src/common/dto/data-respone';
import { Account } from 'src/account/schemas/account.schema';
import { Patient } from 'src/patient/schema/patient.schema';

@Injectable()
export class AuthSaga {

  constructor(private readonly eventEmitter: EventEmitter2,
  ) {}
  // nghe event từ AuthService
  @OnEvent('user.register.requested')
  async handleRegister(payload: any) {
    const { requestId, registerUser } = payload;

    console.log('Saga start for:', registerUser.email);

    //const createdAccountRes = await this.accountService.createAccount(registerUser);
    // Emit event async, đợi listener xử lý xong
    const createdAccountResults = await this.eventEmitter.emitAsync('account.createAccount', registerUser);

    // Lấy kết quả từ listener đầu tiên (nếu chỉ có 1 listener)
    const createdAccountRes = createdAccountResults[0] as DataResponse<Account>;

    if (createdAccountRes.code === rc.ERROR) {
      // Nếu tạo account lỗi, emit event failed
      this.eventEmitter.emit('user.register.failed', {
        requestId,
        dto: registerUser,
        dataRespone: createdAccountRes,
      });
      console.log("[Saga]: ", createdAccountRes.message);
      return;
    }

    console.log("[Saga]: ", createdAccountRes.message, createdAccountRes.data?._id);

    // 2. Lấy accountId và chuẩn bị DTO patient
    const newAccountId = createdAccountRes.data!._id.toString();
    const createdPatientDto: CreatePatientDto = {
      accountId: newAccountId,
      // các trường patient khác nếu cần
    };

    // 3. Tạo Patient thông qua event
    const createdPatientResults = await this.eventEmitter.emitAsync('patient.createPatient', createdPatientDto);

    // Lấy kết quả từ listener đầu tiên (nếu chỉ có 1 listener)
    const createdPatientRes = createdPatientResults[0] as DataResponse<Patient>;
    console.log(createdPatientRes)

    if (createdPatientRes.code === rc.ERROR) {
      // rollback Account
      await this.eventEmitter.emitAsync('account.deleteAccount', registerUser.email);

      // Nếu tạo patient lỗi, emit event failed
      this.eventEmitter.emit('user.register.failed', {
        requestId,
        dto: registerUser,
        error: createdPatientRes.message,
      });
      console.log("[Saga]: ", createdPatientRes.message);
      return;
    }

    console.log("[Saga]:", createdPatientRes.message);

    // 5. Thành công, emit success
    this.eventEmitter.emit('user.register.success', {
      requestId: requestId,
      registerUser: registerUser,
      account: { id: newAccountId, email: registerUser.email },
    });

    // Send otp
    this.eventEmitter.emit('otp.send', registerUser.email);
    console.log("Saga: Created userSuccessfully")
  }
}
