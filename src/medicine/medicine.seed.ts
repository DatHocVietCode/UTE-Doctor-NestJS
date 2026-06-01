import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Medicine } from "./schema/medicine.schema";

@Injectable()
export class MedicineSeeder implements OnModuleInit {
  private readonly logger = new Logger(MedicineSeeder.name);

  constructor(
    @InjectModel(Medicine.name)
    private readonly medicineModel: Model<Medicine>
  ) {}

  async onModuleInit() {
    await this.seedMedicines();
  }

  private async seedMedicines() {
    const medicines = [
      { name: "Paracetamol 500mg", packaging: "Hộp 10 vỉ x 10 viên", unitPrice: 5000 },
      { name: "Amoxicillin 500mg", packaging: "Hộp 12 viên", unitPrice: 12000 },
      { name: "Vitamin C 500mg", packaging: "Hộp 10 vỉ x 10 viên", unitPrice: 3000 },
      { name: "Aspirin 81mg", packaging: "Hộp 2 vỉ x 7 viên", unitPrice: 8000 },
      { name: "Cefalexin 500mg", packaging: "Hộp 10 viên", unitPrice: 10000 },
      { name: "Azithromycin 250mg", packaging: "Hộp 6 viên", unitPrice: 15000 },
      { name: "Efferalgan 500mg", packaging: "Hộp 16 viên sủi", unitPrice: 6500 },
      { name: "Claritine 10mg", packaging: "Hộp 1 vỉ x 10 viên", unitPrice: 8000 },
      { name: "Panadol Extra", packaging: "Hộp 10 vỉ x 10 viên", unitPrice: 6000 },
      { name: "Strepsils Honey & Lemon", packaging: "Hộp 24 viên ngậm", unitPrice: 4500 },
      { name: "Cotrimoxazole", packaging: "Hộp 10 viên", unitPrice: 8000 },
      { name: "Metronidazole 250mg", packaging: "Hộp 20 viên", unitPrice: 5500 },
      { name: "Ibuprofen 200mg", packaging: "Hộp 10 vỉ x 10 viên", unitPrice: 4000 },
      { name: "Diclofenac 50mg", packaging: "Hộp 5 vỉ x 10 viên", unitPrice: 6000 },
      { name: "Omeprazole 20mg", packaging: "Hộp 2 vỉ x 7 viên", unitPrice: 7000 },
      { name: "Loperamide 2mg", packaging: "Hộp 10 viên", unitPrice: 5000 },
      { name: "Salbutamol 2mg", packaging: "Hộp 2 vỉ x 10 viên", unitPrice: 4500 },
      { name: "Cefuroxime 500mg", packaging: "Hộp 2 vỉ x 5 viên", unitPrice: 11000 },
      { name: "Clamoxyl 250mg", packaging: "Hộp 12 viên", unitPrice: 9000 },
      { name: "Augmentin 625mg", packaging: "Hộp 10 viên", unitPrice: 14000 },
      { name: "Telfast 180mg", packaging: "Hộp 1 vỉ x 10 viên", unitPrice: 9000 },
      { name: "Lorastad 10mg", packaging: "Hộp 3 vỉ x 10 viên", unitPrice: 7500 },
      { name: "Zyrtec 10mg", packaging: "Hộp 10 viên", unitPrice: 8500 },
      { name: "Prednisolone 5mg", packaging: "Hộp 10 vỉ x 10 viên", unitPrice: 5500 },
      { name: "Dexamethasone 0.5mg", packaging: "Hộp 10 viên", unitPrice: 4000 },
      { name: "Amlodipine 5mg", packaging: "Hộp 3 vỉ x 10 viên", unitPrice: 6000 },
      { name: "Losartan 50mg", packaging: "Hộp 2 vỉ x 10 viên", unitPrice: 7000 },
      { name: "Perindopril 5mg", packaging: "Hộp 30 viên", unitPrice: 8000 },
      { name: "Simvastatin 20mg", packaging: "Hộp 3 vỉ x 10 viên", unitPrice: 7500 },
      { name: "Atorvastatin 10mg", packaging: "Hộp 3 vỉ x 10 viên", unitPrice: 6500 },
      { name: "Furosemide 40mg", packaging: "Hộp 10 viên", unitPrice: 4500 },
      { name: "Spironolactone 25mg", packaging: "Hộp 10 viên", unitPrice: 5000 },
      { name: "Metformin 500mg", packaging: "Hộp 10 vỉ x 10 viên", unitPrice: 5500 },
      { name: "Gliclazide 80mg", packaging: "Hộp 2 vỉ x 15 viên", unitPrice: 8000 },
      { name: "Insulatard HM", packaging: "Lọ 10ml", unitPrice: 45000 },
      { name: "Glucophage 500mg", packaging: "Hộp 5 vỉ x 20 viên", unitPrice: 6000 },
      { name: "Captopril 25mg", packaging: "Hộp 2 vỉ x 10 viên", unitPrice: 4500 },
      { name: "Enalapril 5mg", packaging: "Hộp 3 vỉ x 10 viên", unitPrice: 5500 },
      { name: "Hydralazine 25mg", packaging: "Hộp 20 viên", unitPrice: 7000 },
      { name: "Propranolol 40mg", packaging: "Hộp 3 vỉ x 10 viên", unitPrice: 6000 },
      { name: "Atenolol 50mg", packaging: "Hộp 3 vỉ x 10 viên", unitPrice: 5500 },
      { name: "Bisoprolol 5mg", packaging: "Hộp 2 vỉ x 10 viên", unitPrice: 6500 },
      { name: "Nifedipine 10mg", packaging: "Hộp 2 vỉ x 10 viên", unitPrice: 5000 },
      { name: "Amoxicillin + Clavulanic acid", packaging: "Hộp 10 viên", unitPrice: 14000 },
      { name: "Ceftriaxone 1g", packaging: "Ống bột pha tiêm", unitPrice: 22000 },
      { name: "Cefotaxime 1g", packaging: "Ống bột pha tiêm", unitPrice: 24000 },
      { name: "Gentamycin 80mg", packaging: "Ống tiêm 2ml", unitPrice: 18000 },
      { name: "Ciprofloxacin 500mg", packaging: "Hộp 2 vỉ x 5 viên", unitPrice: 9000 },
      { name: "Levofloxacin 500mg", packaging: "Hộp 10 viên", unitPrice: 11000 },
      { name: "Ranitidine 150mg", packaging: "Hộp 2 vỉ x 10 viên", unitPrice: 5500 },
      { name: "Pantoprazole 40mg", packaging: "Hộp 1 vỉ x 10 viên", unitPrice: 9000 },
      { name: "Esomeprazole 40mg", packaging: "Hộp 1 vỉ x 10 viên", unitPrice: 10000 },
      { name: "Domperidone 10mg", packaging: "Hộp 3 vỉ x 10 viên", unitPrice: 6500 },
      { name: "Metoclopramide 10mg", packaging: "Hộp 10 viên", unitPrice: 4500 },
      { name: "Clopidogrel 75mg", packaging: "Hộp 2 vỉ x 10 viên", unitPrice: 12000 },
      { name: "Aspirin 100mg", packaging: "Hộp 3 vỉ x 10 viên", unitPrice: 6000 },
      { name: "Warfarin 5mg", packaging: "Hộp 2 vỉ x 10 viên", unitPrice: 8000 },
      { name: "Heparin 5000 IU", packaging: "Ống tiêm 5ml", unitPrice: 25000 },
      { name: "Insulin Glargine", packaging: "Bút tiêm 3ml", unitPrice: 55000 },
      { name: "Vitamin B1", packaging: "Hộp 10 vỉ x 10 viên", unitPrice: 2500 },
      { name: "Vitamin B6", packaging: "Hộp 10 vỉ x 10 viên", unitPrice: 2500 },
      { name: "Vitamin B12", packaging: "Hộp 10 vỉ x 10 viên", unitPrice: 3000 },
      { name: "Calcium Carbonate", packaging: "Hộp 10 viên", unitPrice: 4000 },
      { name: "Magnesium B6", packaging: "Hộp 3 vỉ x 10 viên", unitPrice: 5000 },
      { name: "Ferrous Sulfate", packaging: "Hộp 10 vỉ x 10 viên", unitPrice: 3500 },
      { name: "Folic Acid 5mg", packaging: "Hộp 10 vỉ x 10 viên", unitPrice: 3000 },
      { name: "Vitamin D3", packaging: "Chai 10ml", unitPrice: 8000 },
      { name: "Zinc Gluconate", packaging: "Hộp 2 vỉ x 10 viên", unitPrice: 4500 },
      { name: "Cetirizine 10mg", packaging: "Hộp 10 viên", unitPrice: 6000 },
      { name: "Chlorpheniramine 4mg", packaging: "Hộp 10 viên", unitPrice: 4000 },
      { name: "Diphenhydramine", packaging: "Chai 100ml", unitPrice: 12000 },
      { name: "Dextromethorphan", packaging: "Chai 100ml", unitPrice: 10000 },
      { name: "Acetylcysteine 200mg", packaging: "Hộp 30 gói", unitPrice: 8000 },
      { name: "Ambroxol 30mg", packaging: "Hộp 20 viên", unitPrice: 5500 },
      { name: "Bromhexine 8mg", packaging: "Hộp 20 viên", unitPrice: 6000 },
      { name: "Guaifenesin 100mg", packaging: "Chai 100ml", unitPrice: 7000 },
      { name: "Oresol", packaging: "Hộp 10 gói", unitPrice: 2000 },
      { name: "ORS Hydrite", packaging: "Hộp 10 gói", unitPrice: 2500 },
      { name: "Smecta", packaging: "Hộp 30 gói", unitPrice: 12000 },
      { name: "Enterogermina", packaging: "Hộp 20 ống", unitPrice: 18000 },
      { name: "Probio", packaging: "Hộp 10 gói", unitPrice: 8000 },
      { name: "Lactobacillus", packaging: "Hộp 20 gói", unitPrice: 10000 },
      { name: "Nystatin 500,000 IU", packaging: "Hộp 10 viên", unitPrice: 7000 },
      { name: "Fluconazole 150mg", packaging: "Hộp 1 viên", unitPrice: 9000 },
      { name: "Ketoconazole 200mg", packaging: "Hộp 10 viên", unitPrice: 8500 },
      { name: "Miconazole Cream", packaging: "Tuýp 10g", unitPrice: 15000 },
      { name: "Clotrimazole 1%", packaging: "Tuýp 10g", unitPrice: 12000 },
      { name: "Betadine 10%", packaging: "Chai 100ml", unitPrice: 16000 },
      { name: "Hydrocortisone Cream", packaging: "Tuýp 10g", unitPrice: 18000 },
      { name: "Eumovate", packaging: "Tuýp 15g", unitPrice: 25000 },
      { name: "Fucidin", packaging: "Tuýp 15g", unitPrice: 22000 },
      { name: "Bepanthen", packaging: "Tuýp 30g", unitPrice: 28000 },
      { name: "Silvirin", packaging: "Tuýp 10g", unitPrice: 20000 },
      { name: "Tetracycline Ointment", packaging: "Tuýp 5g", unitPrice: 12000 },
      { name: "Eye drop Tobrex", packaging: "Chai 5ml", unitPrice: 24000 },
      { name: "Artificial Tears", packaging: "Chai 10ml", unitPrice: 18000 },
      { name: "Nasal Spray Otrivin", packaging: "Chai 10ml", unitPrice: 15000 },
      { name: "Salonpas Patch", packaging: "Hộp 10 miếng", unitPrice: 16000 },
      { name: "Salonpas Cream", packaging: "Tuýp 30g", unitPrice: 20000 },
      { name: "Salonpas Gel", packaging: "Tuýp 20g", unitPrice: 18000 },
      { name: "Eugica", packaging: "Hộp 2 vỉ x 10 viên", unitPrice: 7000 },
      { name: "Decolgen Forte", packaging: "Hộp 2 vỉ x 10 viên", unitPrice: 8000 },
      { name: "Tiffy", packaging: "Hộp 2 vỉ x 10 viên", unitPrice: 8500 },
      { name: "Panadol Cold & Flu", packaging: "Hộp 10 viên", unitPrice: 6500 },
      { name: "Coldacmin Flu", packaging: "Hộp 10 viên", unitPrice: 7000 },
      { name: "Acemuc 200mg", packaging: "Hộp 30 gói", unitPrice: 9000 },
      { name: "Prospan Syrup", packaging: "Chai 100ml", unitPrice: 14000 },
    ];

    // Use bulkWrite for upsert to handle both new inserts and existing record updates
    const bulkOps = medicines.map((medicine) => ({
      updateOne: {
        filter: { name: medicine.name },
        update: { $set: medicine },
        upsert: true,
      },
    }));

    await this.medicineModel.bulkWrite(bulkOps);
    this.logger.log(`Successfully seeded/updated ${medicines.length} medicines with pricing data.`);
  }
}
