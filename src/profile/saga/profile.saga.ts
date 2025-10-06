import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AccountProfileDto } from "src/account/dto/account.dto";
import { RoleEnum } from "src/common/enum/role.enum";
import { PatientProfileDTO } from "src/patient/dto/patient.dto";
import { emitTyped } from "src/utils/helpers/event.helper";

interface GetProfilePayload {
  role: RoleEnum;
  email: string;
}

@Injectable()
export class ProfileSaga {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  @OnEvent('profile.get')
  async handleGetProfile(payload: GetProfilePayload) {
    const profile = await emitTyped<{email: string}, AccountProfileDto>
    (this.eventEmitter,
        'profile.getProfile',
        { email: payload.email}
    );

    console.log("[Saga]: get profile: ", profile)

    let childProfile: any;
    switch (payload.role) {
        case RoleEnum.PATIENT: {
        childProfile = await emitTyped<{ profileId: string }, PatientProfileDTO>(
            this.eventEmitter,
            'patient.getByProfileId',
            { profileId: profile.id }
        );
        console.log('[Saga] Patient profile fetched');
        break;
        }
        case RoleEnum.DOCTOR: {
        console.log('[Saga] Doctor profile fetching not implemented yet');
        break;
        }
    }
    const response: PatientProfileDTO = {
        accountProfileDto: profile,
        medicalRecord: childProfile?.medicalRecord || null
    };

    console.log('[Saga] Full profile assembled:', response);

    this.eventEmitter.emit('socket.push.patient-profile', { patientProfile: response, roomEmail: payload.email } );
  }
}
