import { PaymentStatusEnum } from 'src/payment/enums/payment-status.enum';
import { Appointment, AppointmentDocument } from '../schemas/appointment.schema';
import { Profile } from 'src/profile/schema/profile.schema';

export interface AppointmentEnriched extends Appointment {
    appointmentId: string;

    doctorName: string | null;
    doctorEmail: string | null;

    patientName: string;
    patientEmail: string;

    amount: number;
    paymentStatus: PaymentStatusEnum;
    paidAt: Date;

    hospitalName: string;
}

export function buildEnrichedAppointmentPayload(
  appointment: AppointmentDocument,
  doctorProfile: Profile | null,
  patientProfile: Profile,
  amount: number,
  patientName: string,
  patientEmail: string
): AppointmentEnriched {

  const base = appointment.toObject(); // convert document → plain object

  console.log('Building enriched appointment payload with:', {
    appointmentId: appointment._id.toString(),
    doctorProfile,
    patientProfile,
    amount,
    patientName,
    patientEmail
  });

  return {
    ...base,
    appointmentId: appointment._id.toString(),

    doctorName: doctorProfile?.name ?? null,
    doctorEmail: doctorProfile?.email ?? null,

    patientName: patientProfile.name,
    patientEmail: patientProfile.email,

    amount,
    paymentStatus: PaymentStatusEnum.COMPLETED,
    paidAt: new Date(),
  };
}
