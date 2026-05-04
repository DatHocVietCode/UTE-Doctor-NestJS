import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Medicine, MedicineDocument } from 'src/medicine/schema/medicine.schema';
import {
    MedicalEncounter,
    MedicalEncounterDocument,
} from './schema/medical-record.schema';

type EncounterPrescriptionInput = {
  medicineId?: string | Types.ObjectId;
  name: string;
  quantity: number;
  note?: string;
};

type CreateEncounterInput = {
  visitId: string | Types.ObjectId;
  appointmentId: string | Types.ObjectId;
  patientId: string | Types.ObjectId;
  doctorId: string | Types.ObjectId;
  diagnosis: string;
  note?: string;
  prescriptions?: EncounterPrescriptionInput[];
  session?: ClientSession;
};

@Injectable()
export class MedicalEncounterService {
  private readonly logger = new Logger(MedicalEncounterService.name);

  constructor(
    @InjectModel(MedicalEncounter.name)
    private readonly medicalEncounterModel: Model<MedicalEncounterDocument>,
    @InjectModel(Medicine.name)
    private readonly medicineModel: Model<MedicineDocument>,
  ) {}

  async createVisitEncounter(input: CreateEncounterInput): Promise<MedicalEncounterDocument> {
    const mappedPrescriptions = await this.mapPrescriptions(input.prescriptions ?? []);

    const [encounter] = await this.medicalEncounterModel.create(
      [
        {
          visitId: new Types.ObjectId(input.visitId),
          appointmentId: new Types.ObjectId(input.appointmentId),
          patientId: new Types.ObjectId(input.patientId),
          createdByDoctorId: new Types.ObjectId(input.doctorId),
          diagnosis: input.diagnosis,
          note: input.note ?? '',
          prescriptions: mappedPrescriptions,
          vitalSigns: [],
          dateRecord: new Date(),
        },
      ],
      input.session ? { session: input.session } : undefined,
    );

    this.logger.log(
      `Stored encounter for visitId=${new Types.ObjectId(input.visitId).toString()} appointmentId=${new Types.ObjectId(input.appointmentId).toString()}`,
    );

    return encounter;
  }

  private async mapPrescriptions(prescriptions: EncounterPrescriptionInput[]) {
    return Promise.all(
      prescriptions.map(async (item) => {
        let medicineObjectId: Types.ObjectId | null = null;

        if (item.medicineId) {
          try {
            medicineObjectId =
              typeof item.medicineId === 'string'
                ? new Types.ObjectId(item.medicineId)
                : item.medicineId;
          } catch {
            medicineObjectId = null;
          }
        }

        let name = item.name;
        if (!name && medicineObjectId) {
          const medicine = await this.medicineModel.findById(medicineObjectId).select('name').lean();
          name = medicine?.name ?? 'Unknown medicine';
        }

        const prescription: EncounterPrescriptionInput = {
          name: name || 'Unknown medicine',
          quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1,
          note: item.note,
        };

        if (medicineObjectId) {
          prescription.medicineId = medicineObjectId;
        }

        return prescription;
      }),
    );
  }
}