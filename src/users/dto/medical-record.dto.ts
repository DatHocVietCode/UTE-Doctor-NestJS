export interface MedicalRecordDescriptionDto {
    name: string;
    description: string;
    dateRecord: Date;
}

export interface MedicalRecordDto {
    medicalHistory: MedicalRecordDescriptionDto[];
    drugAllergies: MedicalRecordDescriptionDto[];
    foodAllergies: MedicalRecordDescriptionDto[];
}