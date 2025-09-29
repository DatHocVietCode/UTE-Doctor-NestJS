import { BloodType } from "src/common/enum/blood-type.enum";

export interface VitalSignRecord {
    value: number | { systolic: number; diastolic: number }; 
    dateRecord: Date;
}

export interface MedicalRecordDescriptionDto {
    name: string;
    description: string;
    dateRecord: Date;

}

export interface MedicalRecordDto {
    height: number;
    weight: number;
    bloodType: BloodType;
    medicalHistory: MedicalRecordDescriptionDto[];
    drugAllergies: MedicalRecordDescriptionDto[];
    foodAllergies: MedicalRecordDescriptionDto[];

    bloodPressure: VitalSignRecord[]; // {systolic, diastolic, dateRecord}
    heartRate: VitalSignRecord[];     // {value, dateRecord}
}