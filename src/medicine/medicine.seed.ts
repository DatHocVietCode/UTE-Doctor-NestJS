import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { Medicine } from "./schema/medicine.schema";

@Injectable()
export class MedicineSeeder implements OnModuleInit {
  private readonly logger = new Logger(MedicineSeeder.name);

  constructor(
    @InjectModel(Medicine.name)
    private readonly medicineModel: Model<Medicine>
  ) {}

  async onModuleInit() {
    const count = await this.medicineModel.countDocuments();
    if (count === 0) {
      await this.seedMedicines();
    } else {
      this.logger.log("Medicine data already exists, skip seeding.");
    }
  }

  private async seedMedicines() {
    const medicines = [
      { name: "Paracetamol 500mg", packaging: "Hộp 10 vỉ x 10 viên" },
      { name: "Amoxicillin 500mg", packaging: "Hộp 12 viên" },
      { name: "Vitamin C 500mg", packaging: "Hộp 10 vỉ x 10 viên" },
      { name: "Aspirin 81mg", packaging: "Hộp 2 vỉ x 7 viên" },
      { name: "Cefalexin 500mg", packaging: "Hộp 10 viên" },
      { name: "Azithromycin 250mg", packaging: "Hộp 6 viên" },
      { name: "Efferalgan 500mg", packaging: "Hộp 16 viên sủi" },
      { name: "Claritine 10mg", packaging: "Hộp 1 vỉ x 10 viên" },
      { name: "Panadol Extra", packaging: "Hộp 10 vỉ x 10 viên" },
      { name: "Strepsils Honey & Lemon", packaging: "Hộp 24 viên ngậm" },
      { name: "Cotrimoxazole", packaging: "Hộp 10 viên" },
      { name: "Metronidazole 250mg", packaging: "Hộp 20 viên" },
      { name: "Ibuprofen 200mg", packaging: "Hộp 10 vỉ x 10 viên" },
      { name: "Diclofenac 50mg", packaging: "Hộp 5 vỉ x 10 viên" },
      { name: "Omeprazole 20mg", packaging: "Hộp 2 vỉ x 7 viên" },
      { name: "Loperamide 2mg", packaging: "Hộp 10 viên" },
      { name: "Salbutamol 2mg", packaging: "Hộp 2 vỉ x 10 viên" },
      { name: "Cefuroxime 500mg", packaging: "Hộp 2 vỉ x 5 viên" },
      { name: "Clamoxyl 250mg", packaging: "Hộp 12 viên" },
      { name: "Augmentin 625mg", packaging: "Hộp 10 viên" },
      { name: "Telfast 180mg", packaging: "Hộp 1 vỉ x 10 viên" },
      { name: "Lorastad 10mg", packaging: "Hộp 3 vỉ x 10 viên" },
      { name: "Zyrtec 10mg", packaging: "Hộp 10 viên" },
      { name: "Prednisolone 5mg", packaging: "Hộp 10 vỉ x 10 viên" },
      { name: "Dexamethasone 0.5mg", packaging: "Hộp 10 viên" },
      { name: "Amlodipine 5mg", packaging: "Hộp 3 vỉ x 10 viên" },
      { name: "Losartan 50mg", packaging: "Hộp 2 vỉ x 10 viên" },
      { name: "Perindopril 5mg", packaging: "Hộp 30 viên" },
      { name: "Simvastatin 20mg", packaging: "Hộp 3 vỉ x 10 viên" },
      { name: "Atorvastatin 10mg", packaging: "Hộp 3 vỉ x 10 viên" },
      { name: "Furosemide 40mg", packaging: "Hộp 10 viên" },
      { name: "Spironolactone 25mg", packaging: "Hộp 10 viên" },
      { name: "Metformin 500mg", packaging: "Hộp 10 vỉ x 10 viên" },
      { name: "Gliclazide 80mg", packaging: "Hộp 2 vỉ x 15 viên" },
      { name: "Insulatard HM", packaging: "Lọ 10ml" },
      { name: "Glucophage 500mg", packaging: "Hộp 5 vỉ x 20 viên" },
      { name: "Captopril 25mg", packaging: "Hộp 2 vỉ x 10 viên" },
      { name: "Enalapril 5mg", packaging: "Hộp 3 vỉ x 10 viên" },
      { name: "Hydralazine 25mg", packaging: "Hộp 20 viên" },
      { name: "Propranolol 40mg", packaging: "Hộp 3 vỉ x 10 viên" },
      { name: "Atenolol 50mg", packaging: "Hộp 3 vỉ x 10 viên" },
      { name: "Bisoprolol 5mg", packaging: "Hộp 2 vỉ x 10 viên" },
      { name: "Nifedipine 10mg", packaging: "Hộp 2 vỉ x 10 viên" },
      { name: "Amoxicillin + Clavulanic acid", packaging: "Hộp 10 viên" },
      { name: "Ceftriaxone 1g", packaging: "Ống bột pha tiêm" },
      { name: "Cefotaxime 1g", packaging: "Ống bột pha tiêm" },
      { name: "Gentamycin 80mg", packaging: "Ống tiêm 2ml" },
      { name: "Ciprofloxacin 500mg", packaging: "Hộp 2 vỉ x 5 viên" },
      { name: "Levofloxacin 500mg", packaging: "Hộp 10 viên" },
      { name: "Ranitidine 150mg", packaging: "Hộp 2 vỉ x 10 viên" },
      { name: "Pantoprazole 40mg", packaging: "Hộp 1 vỉ x 10 viên" },
      { name: "Esomeprazole 40mg", packaging: "Hộp 1 vỉ x 10 viên" },
      { name: "Domperidone 10mg", packaging: "Hộp 3 vỉ x 10 viên" },
      { name: "Metoclopramide 10mg", packaging: "Hộp 10 viên" },
      { name: "Clopidogrel 75mg", packaging: "Hộp 2 vỉ x 10 viên" },
      { name: "Aspirin 100mg", packaging: "Hộp 3 vỉ x 10 viên" },
      { name: "Warfarin 5mg", packaging: "Hộp 2 vỉ x 10 viên" },
      { name: "Heparin 5000 IU", packaging: "Ống tiêm 5ml" },
      { name: "Insulin Glargine", packaging: "Bút tiêm 3ml" },
      { name: "Vitamin B1", packaging: "Hộp 10 vỉ x 10 viên" },
      { name: "Vitamin B6", packaging: "Hộp 10 vỉ x 10 viên" },
      { name: "Vitamin B12", packaging: "Hộp 10 vỉ x 10 viên" },
      { name: "Calcium Carbonate", packaging: "Hộp 10 viên" },
      { name: "Magnesium B6", packaging: "Hộp 3 vỉ x 10 viên" },
      { name: "Ferrous Sulfate", packaging: "Hộp 10 vỉ x 10 viên" },
      { name: "Folic Acid 5mg", packaging: "Hộp 10 vỉ x 10 viên" },
      { name: "Vitamin D3", packaging: "Chai 10ml" },
      { name: "Zinc Gluconate", packaging: "Hộp 2 vỉ x 10 viên" },
      { name: "Cetirizine 10mg", packaging: "Hộp 10 viên" },
      { name: "Chlorpheniramine 4mg", packaging: "Hộp 10 viên" },
      { name: "Diphenhydramine", packaging: "Chai 100ml" },
      { name: "Dextromethorphan", packaging: "Chai 100ml" },
      { name: "Acetylcysteine 200mg", packaging: "Hộp 30 gói" },
      { name: "Ambroxol 30mg", packaging: "Hộp 20 viên" },
      { name: "Bromhexine 8mg", packaging: "Hộp 20 viên" },
      { name: "Guaifenesin 100mg", packaging: "Chai 100ml" },
      { name: "Oresol", packaging: "Hộp 10 gói" },
      { name: "ORS Hydrite", packaging: "Hộp 10 gói" },
      { name: "Smecta", packaging: "Hộp 30 gói" },
      { name: "Enterogermina", packaging: "Hộp 20 ống" },
      { name: "Probio", packaging: "Hộp 10 gói" },
      { name: "Lactobacillus", packaging: "Hộp 20 gói" },
      { name: "Nystatin 500,000 IU", packaging: "Hộp 10 viên" },
      { name: "Fluconazole 150mg", packaging: "Hộp 1 viên" },
      { name: "Ketoconazole 200mg", packaging: "Hộp 10 viên" },
      { name: "Miconazole Cream", packaging: "Tuýp 10g" },
      { name: "Clotrimazole 1%", packaging: "Tuýp 10g" },
      { name: "Betadine 10%", packaging: "Chai 100ml" },
      { name: "Hydrocortisone Cream", packaging: "Tuýp 10g" },
      { name: "Eumovate", packaging: "Tuýp 15g" },
      { name: "Fucidin", packaging: "Tuýp 15g" },
      { name: "Bepanthen", packaging: "Tuýp 30g" },
      { name: "Silvirin", packaging: "Tuýp 10g" },
      { name: "Tetracycline Ointment", packaging: "Tuýp 5g" },
      { name: "Eye drop Tobrex", packaging: "Chai 5ml" },
      { name: "Artificial Tears", packaging: "Chai 10ml" },
      { name: "Nasal Spray Otrivin", packaging: "Chai 10ml" },
      { name: "Salonpas Patch", packaging: "Hộp 10 miếng" },
      { name: "Salonpas Cream", packaging: "Tuýp 30g" },
      { name: "Salonpas Gel", packaging: "Tuýp 20g" },
      { name: "Eugica", packaging: "Hộp 2 vỉ x 10 viên" },
      { name: "Decolgen Forte", packaging: "Hộp 2 vỉ x 10 viên" },
      { name: "Tiffy", packaging: "Hộp 2 vỉ x 10 viên" },
      { name: "Panadol Cold & Flu", packaging: "Hộp 10 viên" },
      { name: "Coldacmin Flu", packaging: "Hộp 10 viên" },
      { name: "Acemuc 200mg", packaging: "Hộp 30 gói" },
      { name: "Prospan Syrup", packaging: "Chai 100ml" },
    ];

    await this.medicineModel.insertMany(medicines);
    this.logger.log(`Inserted ${medicines.length} medicines.`);
  }
}
