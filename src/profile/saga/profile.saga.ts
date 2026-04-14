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
    // Merge child profile (patient) data with account profile, preserving new collections
    const response: PatientProfileDTO = {
      accountProfileDto: profile,
      medicalRecord: childProfile?.medicalRecord || null,
      medicalProfile: childProfile?.medicalProfile ?? null,
      encounters: childProfile?.encounters ?? [],
      allergies: childProfile?.allergies ?? [],
      medicalHistory: (() => {
        // Prefer new collection from service
        if (Array.isArray(childProfile?.medicalHistory) && childProfile.medicalHistory.length) return childProfile.medicalHistory;

        // Fallback: map legacy medicalRecord.medicalHistory (various legacy shapes)
        const legacy = childProfile?.medicalRecord?.medicalHistory;
        if (!Array.isArray(legacy)) return [];
        return legacy.map((item: any) => ({
          // New schema expects conditionName/diagnosedAt/status/source
          conditionName: item?.conditionName || item?.diagnosis || item?.name || 'Chẩn đoán',
          diagnosisCode: item?.diagnosisCode,
          diagnosedAt: item?.diagnosedAt || item?.dateRecord || item?.createdAt || undefined,
          status: 'ONGOING',
          source: 'PATIENT',
          verifiedByDoctor: false,
          // keep raw references if present; FE treats these as plain objects
          patientId: (childProfile as any)?._id || (childProfile as any)?.patientId,
          createdByRole: 'PATIENT',
          createdAt: item?.createdAt || item?.dateRecord || new Date(),
          updatedAt: item?.updatedAt || item?.dateRecord || new Date(),
          // passthrough for FE display of notes (not part of strict schema, tolerated by FE)
          note: item?.note || item?.description,
        }));
      })(),
    } as any;

    console.log('[Saga] Full patient profile assembled for socket:', JSON.stringify(response, null, 2));

    this.eventEmitter.emit('socket.push.patient-profile', { patientProfile: response, roomEmail: payload.email } );
  }
}
