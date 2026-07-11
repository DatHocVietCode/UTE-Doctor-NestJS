import { toAdminPatientListItem } from './patient.service';

describe('toAdminPatientListItem (req 5 — admin patient PII scoping)', () => {
  it('exposes only name + status + accountId from a fully populated patient', () => {
    const patient = {
      _id: 'p1',
      height: 170,
      weight: 65,
      bloodType: 'O',
      medicalProfileId: 'mp1',
      medicalRecord: { medicalHistory: ['x'] },
      profileId: { _id: 'prof1', name: 'Nguyễn B', phone: '090', email: 'a@b.com', gender: 'M', dob: new Date(), avatarUrl: 'u' },
      accountId: { _id: 'a1', status: 'ACTIVE', email: 'a@b.com', role: 'PATIENT' },
    };
    const item = toAdminPatientListItem(patient);
    expect(item).toEqual({ name: 'Nguyễn B', status: 'ACTIVE', accountId: 'a1' });
    expect(Object.keys(item).sort()).toEqual(['accountId', 'name', 'status']);
    for (const leaked of ['phone', 'email', 'gender', 'dob', 'avatarUrl', 'height', 'weight', 'bloodType', 'medicalRecord', 'medicalProfileId', 'role']) {
      expect((item as any)[leaked]).toBeUndefined();
    }
  });

  it('is null-safe when profile/account are unpopulated', () => {
    expect(toAdminPatientListItem({ accountId: null, profileId: null })).toEqual({ name: null, status: null, accountId: null });
  });

  it('falls back to a raw accountId when the account is not populated', () => {
    expect(toAdminPatientListItem({ profileId: { name: 'X' }, accountId: 'rawId' })).toEqual({ name: 'X', status: null, accountId: 'rawId' });
  });
});
