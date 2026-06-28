import { ReceptionistService } from './receptionist.service';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { RoleEnum } from 'src/common/enum/role.enum';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';

// Unit tests for the admin receptionist-provisioning flow. Same mocking strategy as the
// doctor suite: models + transaction session are mocked.
describe('ReceptionistService.createWithAccount', () => {
  let service: ReceptionistService;
  let receptionistModel: any;
  let profileModel: any;
  let accountModel: any;
  let mailService: any;
  let cloudinaryService: any;
  let session: any;

  const baseDto = () => ({
    hospitalName: 'UTE Clinic',
    profile: { name: 'Reception Anna', email: 'anna@hospital.test', phone: '0999' },
  });

  beforeEach(() => {
    session = {
      withTransaction: jest.fn(async (cb: () => Promise<void>) => {
        await cb();
      }),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    profileModel = {
      create: jest.fn().mockResolvedValue([{ _id: 'profile-1', name: 'Reception Anna', phone: '0999' }]),
    };
    accountModel = {
      exists: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue([
        { _id: 'account-1', email: 'anna@hospital.test', role: RoleEnum.RECEPTIONIST, status: AccountStatusEnum.ACTIVE },
      ]),
    };
    receptionistModel = {
      db: { startSession: jest.fn().mockResolvedValue(session) },
      create: jest.fn().mockResolvedValue([{ _id: 'receptionist-1' }]),
    };
    mailService = { sendAccountCreatedMail: jest.fn().mockResolvedValue(undefined) };
    cloudinaryService = { uploadFileBuffer: jest.fn() };

    // constructor: (appointmentModel, accountModel, profileModel, receptionistModel,
    //               billingService, paymentService, mailService, cloudinaryService)
    service = new ReceptionistService(
      {} as any,
      accountModel,
      profileModel,
      receptionistModel,
      {} as any,
      {} as any,
      mailService,
      cloudinaryService,
    );
  });

  it('creates Account + Profile + Receptionist in one transaction and returns a structured response', async () => {
    const res = await service.createWithAccount(baseDto() as any);

    expect(res.code).toBe(rc.SUCCESS);
    expect(profileModel.create).toHaveBeenCalledWith(expect.any(Array), { session });
    expect(accountModel.create).toHaveBeenCalledWith(expect.any(Array), { session });
    expect(receptionistModel.create).toHaveBeenCalledWith(expect.any(Array), { session });
    expect(res.data).toMatchObject({
      account: {
        id: 'account-1',
        email: 'anna@hospital.test',
        role: RoleEnum.RECEPTIONIST,
        status: AccountStatusEnum.ACTIVE,
      },
      profile: { id: 'profile-1', fullName: 'Reception Anna', phone: '0999' },
      receptionist: { id: 'receptionist-1' },
      emailSent: true,
    });
    expect(JSON.stringify(res.data)).not.toMatch(/password/i);
    expect(session.endSession).toHaveBeenCalled();
  });

  it('creates the account ACTIVE with role RECEPTIONIST so login works immediately', async () => {
    await service.createWithAccount(baseDto() as any);

    const accountPayload = accountModel.create.mock.calls[0][0][0];
    const mailPayload = mailService.sendAccountCreatedMail.mock.calls[0][0];
    expect(accountPayload.role).toBe(RoleEnum.RECEPTIONIST);
    expect(accountPayload.status).toBe(AccountStatusEnum.ACTIVE);
    expect(typeof accountPayload.password).toBe('string');
    expect(accountPayload.password.length).toBeGreaterThan(20);
    expect(mailPayload).toMatchObject({
      toEmail: 'anna@hospital.test',
      role: RoleEnum.RECEPTIONIST,
    });
    expect(mailPayload.password).toHaveLength(12);
    expect(mailPayload.password).not.toBe(accountPayload.password);
  });

  it('rejects a duplicate email and creates no records', async () => {
    accountModel.exists.mockResolvedValue({ _id: 'existing' });

    const res = await service.createWithAccount(baseDto() as any);

    expect(res.code).toBe(rc.ERROR);
    expect(profileModel.create).not.toHaveBeenCalled();
    expect(accountModel.create).not.toHaveBeenCalled();
    expect(receptionistModel.create).not.toHaveBeenCalled();
    expect(receptionistModel.db.startSession).not.toHaveBeenCalled();
  });

  it('rolls back (no partial records) when a mid-step write fails', async () => {
    receptionistModel.create.mockRejectedValue(new Error('receptionist insert failed'));

    const res = await service.createWithAccount(baseDto() as any);

    expect(res.code).toBe(rc.ERROR);
    expect(res.data).toBeNull();
    expect(session.endSession).toHaveBeenCalled();
  });
});

describe('ReceptionistService.listReceptionists', () => {
  let service: ReceptionistService;
  let receptionistModel: any;

  // chainable query mock: find().sort().populate().populate().lean().exec() => docs
  const makeQuery = (result: any[]) => {
    const q: any = {};
    q.sort = jest.fn().mockReturnValue(q);
    q.populate = jest.fn().mockReturnValue(q);
    q.lean = jest.fn().mockReturnValue(q);
    q.exec = jest.fn().mockResolvedValue(result);
    return q;
  };

  const docs = () => [
    {
      _id: 'rec-1',
      hospitalName: 'UTE Clinic',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-02-01T00:00:00.000Z'),
      profileId: {
        _id: 'prof-1',
        name: 'Reception Anna',
        phone: '0999',
        email: 'anna@hospital.test',
        gender: 'female',
        dob: new Date('1990-05-10T00:00:00.000Z'),
        address: 'HCM',
        avatarUrl: 'https://img/anna.png',
      },
      // populated account intentionally carries a password to prove it is NOT leaked
      accountId: { _id: 'acc-1', email: 'anna@hospital.test', status: 'ACTIVE', password: 'SUPER_SECRET_HASH' },
    },
    // legacy/broken row: dangling refs populated as null
    {
      _id: 'rec-2',
      hospitalName: undefined,
      createdAt: new Date('2024-03-01T00:00:00.000Z'),
      updatedAt: null,
      profileId: null,
      accountId: null,
    },
  ];

  const buildService = (result: any[]) => {
    receptionistModel = { find: jest.fn().mockReturnValue(makeQuery(result)) };
    return new ReceptionistService(
      {} as any,
      {} as any,
      {} as any,
      receptionistModel,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  };

  it('returns mapped receptionist rows with profile + account display fields and pagination', async () => {
    service = buildService(docs());

    const res = await service.listReceptionists({} as any);

    expect(res.code).toBe(rc.SUCCESS);
    expect(res.data?.pagination).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });

    const anna = res.data!.receptionists.find((r) => r.receptionistId === 'rec-1')!;
    expect(anna).toMatchObject({
      receptionistId: 'rec-1',
      accountId: 'acc-1',
      profileId: 'prof-1',
      email: 'anna@hospital.test',
      fullName: 'Reception Anna',
      phone: '0999',
      gender: 'female',
      address: 'HCM',
      avatarUrl: 'https://img/anna.png',
      hospitalName: 'UTE Clinic',
      accountStatus: 'ACTIVE',
    });
    // date fields are epoch ms
    expect(typeof anna.dateOfBirth).toBe('number');
    expect(typeof anna.createdAt).toBe('number');
    expect(typeof anna.updatedAt).toBe('number');
  });

  it('never leaks password / hash', async () => {
    service = buildService(docs());

    const res = await service.listReceptionists({} as any);

    const serialized = JSON.stringify(res.data);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toContain('SUPER_SECRET_HASH');
  });

  it('does not crash on legacy rows with missing profile/account', async () => {
    service = buildService(docs());

    const res = await service.listReceptionists({} as any);

    const broken = res.data!.receptionists.find((r) => r.receptionistId === 'rec-2')!;
    expect(broken).toMatchObject({
      receptionistId: 'rec-2',
      accountId: null,
      profileId: null,
      email: '',
      fullName: '',
    });
    expect(broken.accountStatus).toBeUndefined();
  });

  it('filters by case-insensitive search on name/email', async () => {
    service = buildService(docs());

    const res = await service.listReceptionists({ search: 'ANNA' } as any);

    expect(res.data!.receptionists).toHaveLength(1);
    expect(res.data!.receptionists[0].receptionistId).toBe('rec-1');
    expect(res.data!.pagination.total).toBe(1);
  });

  it('applies pagination (page/limit)', async () => {
    service = buildService(docs());

    const res = await service.listReceptionists({ page: 1, limit: 1 } as any);

    expect(res.data!.receptionists).toHaveLength(1);
    expect(res.data!.pagination).toEqual({ total: 2, page: 1, limit: 1, totalPages: 2 });
  });
});
