// Follow the repo convention: mock the schema modules (ts-jest strips decorator metadata)
// and construct the service directly with fake models whose `aggregate` is a jest mock.
jest.mock('src/appointment/schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('src/review/schema/review.schema', () => ({ Review: class Review {} }));
jest.mock('src/billing/billing.schema', () => ({ Billing: class Billing {} }));

import { AdminAnalyticsService } from './admin-analytics.service';

function model(aggregateReturn: any = []) {
  return { aggregate: jest.fn().mockResolvedValue(aggregateReturn) } as any;
}

// Convenience: build a service with a fake billing model returning a single-element
// $facet result array (aggregate() with $facet resolves to [{ totals, byDoctor, ... }]).
function serviceWithBillingFacet(facet: any) {
  return new AdminAnalyticsService(model(), model(), model([facet]));
}

describe('AdminAnalyticsService', () => {
  describe('topSpecialties (req 1)', () => {
    it('echoes ranked items and unattributedCount, with the default 3-month window', async () => {
      const facet = [{ ranked: [{ specialtyId: 's1', name: 'Tim mạch', examCount: 10 }], unattributed: [{ count: 4 }] }];
      const service = new AdminAnalyticsService(model(facet), model(), model());
      const res = await service.topSpecialties({});
      const data = res.data!;
      expect(res.code).toBe('SUCCESS');
      expect(data.items).toEqual([{ specialtyId: 's1', name: 'Tim mạch', examCount: 10 }]);
      expect(data.unattributedCount).toBe(4);
      expect(data.window.from).toBeLessThan(data.window.to as number); // default window applied
    });

    it('returns empty items and 0 unattributed when there is no data', async () => {
      const service = new AdminAnalyticsService(model([{ ranked: [], unattributed: [] }]), model(), model());
      const data = (await service.topSpecialties({})).data!;
      expect(data.items).toEqual([]);
      expect(data.unattributedCount).toBe(0);
    });
  });

  describe('topDoctors (req 2)', () => {
    it('returns doctor volume items', async () => {
      const rows = [{ doctorId: 'd1', doctorName: 'BS. A', examCount: 30 }];
      const data = (await new AdminAnalyticsService(model(rows), model(), model()).topDoctors({})).data!;
      expect(data.items).toEqual(rows);
    });

    it('resolves the doctor name from the linked Profile (Profile.name), since Doctor.doctorName is unpopulated', async () => {
      const appt = model();
      await new AdminAnalyticsService(appt, model(), model()).topDoctors({});
      const pipeline = appt.aggregate.mock.calls[0][0];
      const project = pipeline.find((s: any) => s.$project)?.$project;
      expect(project.doctorName).toBe('$profile.name');
      // and the pipeline joins profiles via the doctor's profileId
      const profileLookup = pipeline.find((s: any) => s.$lookup?.from === 'profiles')?.$lookup;
      expect(profileLookup.localField).toBe('doctor.profileId');
    });
  });

  describe('topRatedDoctors (req 3)', () => {
    it('is all-time by default: window is null and empty reviews yield empty items', async () => {
      const data = (await new AdminAnalyticsService(model(), model([]), model()).topRatedDoctors({})).data!;
      expect(data.window).toBeNull();
      expect(data.items).toEqual([]);
    });

    it('windows on Review.createdAt only when from/to are passed', async () => {
      const review = model();
      const res = await new AdminAnalyticsService(model(), review, model()).topRatedDoctors({ from: 100, to: 200 });
      expect(res.data!.window).toEqual({ from: 100, to: 200 });
      const pipeline = review.aggregate.mock.calls[0][0];
      expect(pipeline[0]).toEqual({ $match: { createdAt: { $gte: 100, $lte: 200 } } });
    });

    it('passes through avgRating (1–10 scale) and reviewCount', async () => {
      const rows = [{ doctorId: 'd1', doctorName: 'BS. A', avgRating: 9.3, reviewCount: 12 }];
      const data = (await new AdminAnalyticsService(model(), model(rows), model()).topRatedDoctors({})).data!;
      expect(data.items).toEqual(rows);
    });
  });

  describe('frequentPatients (req 4)', () => {
    it('maps resolved and unresolved (landmine) rows null-safely and PII-compliantly', async () => {
      const rows = [
        { examCount: 8, patient: { _id: 'p1', accountId: 'a1' }, profile: { name: 'Nguyễn B' }, account: { _id: 'a1', status: 'ACTIVE' } },
        { examCount: 3, patient: null, profile: null, account: null }, // patientId did not resolve
      ];
      const data = (await new AdminAnalyticsService(model(rows), model(), model()).frequentPatients({})).data!;
      expect(data.items).toEqual([
        { accountId: 'a1', name: 'Nguyễn B', status: 'ACTIVE', examCount: 8 },
        { accountId: null, name: null, status: null, examCount: 3 },
      ]);
      for (const item of data.items) {
        expect(Object.keys(item).sort()).toEqual(['accountId', 'examCount', 'name', 'status']);
      }
    });
  });

  describe('revenue (req 6)', () => {
    it('computes totalRevenue as consultation + medication and echoes paidBillingCount', async () => {
      const facet = {
        totals: [{ consult: 1100000, med: 630000, count: 11 }],
        byDoctor: [],
        bySpecialty: [],
        dispensed: [],
        external: [],
      };
      const service = serviceWithBillingFacet(facet);
      const data = (await service.revenue({})).data!;
      expect(data.totalConsultationRevenue).toBe(1100000);
      expect(data.totalMedicationRevenue).toBe(630000);
      expect(data.totalRevenue).toBe(1730000);
      expect(data.paidBillingCount).toBe(11);
    });

    it('reports zero totals and paidBillingCount when there is no PAID billing at all', async () => {
      const facet = { totals: [], byDoctor: [], bySpecialty: [], dispensed: [], external: [] };
      const data = (await serviceWithBillingFacet(facet).revenue({})).data!;
      expect(data.totalConsultationRevenue).toBe(0);
      expect(data.totalMedicationRevenue).toBe(0);
      expect(data.totalRevenue).toBe(0);
      expect(data.paidBillingCount).toBe(0);
    });

    it('passes through byDoctor/bySpecialty items (revenue + resolved names) and echoes PRE-limit counts', async () => {
      const facet = {
        totals: [{ consult: 1100000, med: 630000, count: 11 }],
        byDoctorCount: [{ count: 2 }],
        byDoctor: [
          { doctorId: 'd1', doctorName: 'BS. Nguyễn Đạt', consultationRevenue: 1000000, medicationRevenue: 485000, revenue: 1485000, billingCount: 10 },
        ], // only 1 item returned (post-$limit) even though byDoctorCount says 2 exist
        bySpecialtyCount: [{ count: 2 }],
        bySpecialty: [
          { specialtyId: 's1', name: 'Trung tâm tim mạch', consultationRevenue: 1000000, medicationRevenue: 485000, revenue: 1485000, billingCount: 10 },
        ],
        dispensed: [],
        external: [],
      };
      const data = (await serviceWithBillingFacet(facet).revenue({})).data!;
      expect(data.byDoctor).toEqual(facet.byDoctor);
      expect(data.bySpecialty).toEqual(facet.bySpecialty);
      // The count metadata reflects the true pre-limit population (2), NOT the
      // truncated post-$limit array length (1) — this is the bug a naive
      // `byDoctor.length` implementation would produce.
      expect(data.doctorsWithRevenueCount).toBe(2);
      expect(data.specialtiesWithRevenueCount).toBe(2);
    });

    it('a doctor/specialty with no PAID billing simply does not appear — no error, no synthesized zero row', async () => {
      const facet = {
        totals: [{ consult: 100000, med: 0, count: 1 }],
        byDoctorCount: [{ count: 1 }],
        byDoctor: [{ doctorId: 'd1', doctorName: 'BS. A', consultationRevenue: 100000, medicationRevenue: 0, revenue: 100000, billingCount: 1 }],
        bySpecialtyCount: [{ count: 1 }],
        bySpecialty: [{ specialtyId: 's1', name: 'X', consultationRevenue: 100000, medicationRevenue: 0, revenue: 100000, billingCount: 1 }],
        dispensed: [],
        external: [],
      };
      const data = (await serviceWithBillingFacet(facet).revenue({})).data!;
      expect(data.byDoctor).toHaveLength(1);
      expect(data.byDoctor.some((d) => d.revenue === 0)).toBe(false);
      expect(data.bySpecialty).toHaveLength(1);
    });

    it('topDispensedMedications carries both totalQty and lineCount (plus revenue)', async () => {
      const facet = {
        totals: [],
        byDoctor: [],
        bySpecialty: [],
        dispensed: [{ medicineId: 'm1', medicineName: 'Acemuc 200mg', totalQty: 25, lineCount: 4, revenue: 225000 }],
        external: [],
      };
      const data = (await serviceWithBillingFacet(facet).revenue({})).data!;
      expect(data.topDispensedMedications).toEqual([
        { medicineId: 'm1', medicineName: 'Acemuc 200mg', totalQty: 25, lineCount: 4, revenue: 225000 },
      ]);
    });

    it('topExternalMedications omits revenue (external lines are never charged) and is [] on the current empty live-data state', async () => {
      const emptyFacet = { totals: [], byDoctor: [], bySpecialty: [], dispensed: [], external: [] };
      const emptyData = (await serviceWithBillingFacet(emptyFacet).revenue({})).data!;
      expect(emptyData.topExternalMedications).toEqual([]);

      const facetWithExternal = {
        totals: [],
        byDoctor: [],
        bySpecialty: [],
        dispensed: [],
        external: [{ medicineId: 'm2', medicineName: 'Paracetamol', totalQty: 6, lineCount: 2 }],
      };
      const data = (await serviceWithBillingFacet(facetWithExternal).revenue({})).data!;
      expect(data.topExternalMedications).toEqual([{ medicineId: 'm2', medicineName: 'Paracetamol', totalQty: 6, lineCount: 2 }]);
      expect((data.topExternalMedications[0] as any).revenue).toBeUndefined();
    });

    it('coalesces a missing medicineId to null when the catalog reference is absent', async () => {
      const facet = {
        totals: [],
        byDoctor: [],
        bySpecialty: [],
        dispensed: [{ medicineId: null, medicineName: 'Homemade Tonic', totalQty: 3, lineCount: 1, revenue: 15000 }],
        external: [],
      };
      const data = (await serviceWithBillingFacet(facet).revenue({})).data!;
      expect(data.topDispensedMedications[0].medicineId).toBeNull();
      expect(data.topDispensedMedications[0].medicineName).toBe('Homemade Tonic');
    });

    it('echoes window and limit like the other analytics endpoints', async () => {
      const facet = { totals: [], byDoctor: [], bySpecialty: [], dispensed: [], external: [] };
      const data = (await serviceWithBillingFacet(facet).revenue({ from: 100, to: 200, limit: 10 })).data!;
      expect(data.window).toEqual({ from: 100, to: 200 });
    });

    it('base $match filters status=PAID and passes createdAt bounds as actual Date instances, not raw numbers', async () => {
      const billing = model([{ totals: [], byDoctor: [], bySpecialty: [], dispensed: [], external: [] }]);
      const service = new AdminAnalyticsService(model(), model(), billing);
      await service.revenue({ from: 100, to: 200 });
      const pipeline = billing.aggregate.mock.calls[0][0];
      const baseMatch = pipeline[0].$match;
      expect(baseMatch.status).toBe('PAID');
      expect(baseMatch.createdAt.$gte).toBeInstanceOf(Date);
      expect(baseMatch.createdAt.$lte).toBeInstanceOf(Date);
      expect(typeof baseMatch.createdAt.$gte).not.toBe('number');
    });

    it('is null-safe when a doctor/specialty profile fails to resolve a name', async () => {
      const facet = {
        totals: [{ consult: 100000, med: 0, count: 1 }],
        byDoctorCount: [{ count: 1 }],
        byDoctor: [{ doctorId: 'd1', doctorName: null, consultationRevenue: 100000, medicationRevenue: 0, revenue: 100000, billingCount: 1 }],
        bySpecialtyCount: [{ count: 1 }],
        bySpecialty: [{ specialtyId: null, name: null, consultationRevenue: 100000, medicationRevenue: 0, revenue: 100000, billingCount: 1 }],
        dispensed: [],
        external: [],
      };
      const data = (await serviceWithBillingFacet(facet).revenue({})).data!;
      expect(data.byDoctor[0].doctorName).toBeNull();
      expect(data.bySpecialty[0].name).toBeNull();
    });
  });
});
