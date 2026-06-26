import { DoctorService } from './doctor.service';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { RoleEnum } from 'src/common/enum/role.enum';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';

// Unit tests for the admin doctor-provisioning flow. Mongoose models + the transaction
// session are mocked: `withTransaction` simply runs the callback (and rethrows), so we can
// assert the orchestration without a live replica set.
describe('DoctorService.createWithAccount', () => {
  let service: DoctorService;
  let doctorModel: any;
  let profileModel: any;
  let accountModel: any;
  let mailService: any;
  let cloudinaryService: any;
  let session: any;

  const baseDto = () => ({
    doctorName: 'Dr House',
    profile: { name: 'Dr House', email: 'house@hospital.test', phone: '0123' },
  });

  beforeEach(() => {
    session = {
      withTransaction: jest.fn(async (cb: () => Promise<void>) => {
        await cb();
      }),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    profileModel = {
      create: jest.fn().mockResolvedValue([{ _id: 'profile-1', name: 'Dr House', phone: '0123' }]),
    };
    accountModel = {
      exists: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue([
        { _id: 'account-1', email: 'house@hospital.test', role: RoleEnum.DOCTOR, status: AccountStatusEnum.ACTIVE },
      ]),
    };
    doctorModel = {
      db: { startSession: jest.fn().mockResolvedValue(session) },
      create: jest.fn().mockResolvedValue([{ _id: 'doctor-1', chuyenKhoaId: undefined }]),
    };
    mailService = { sendAccountCreatedMail: jest.fn().mockResolvedValue(undefined) };
    cloudinaryService = { uploadFileBuffer: jest.fn() };

    service = new DoctorService(
      doctorModel,
      profileModel,
      accountModel,
      {} as any,
      mailService,
      cloudinaryService,
    );
  });

  it('creates Account + Profile + Doctor in one transaction and returns a structured response (no password)', async () => {
    const res = await service.createWithAccount(baseDto() as any);

    expect(res.code).toBe(rc.SUCCESS);
    // every write shares the same transaction session
    expect(profileModel.create).toHaveBeenCalledWith(expect.any(Array), { session });
    expect(accountModel.create).toHaveBeenCalledWith(expect.any(Array), { session });
    expect(doctorModel.create).toHaveBeenCalledWith(expect.any(Array), { session });
    expect(res.data).toMatchObject({
      account: {
        id: 'account-1',
        email: 'house@hospital.test',
        role: RoleEnum.DOCTOR,
        status: AccountStatusEnum.ACTIVE,
      },
      profile: { id: 'profile-1', fullName: 'Dr House', phone: '0123' },
      doctor: { id: 'doctor-1' },
      emailSent: true,
    });
    // never leak credentials
    expect(JSON.stringify(res.data)).not.toMatch(/password/i);
    expect(session.endSession).toHaveBeenCalled();
  });

  it('creates the account ACTIVE with role DOCTOR and a hashed password so login works immediately', async () => {
    await service.createWithAccount(baseDto() as any);

    const accountPayload = accountModel.create.mock.calls[0][0][0];
    expect(accountPayload.role).toBe(RoleEnum.DOCTOR);
    expect(accountPayload.status).toBe(AccountStatusEnum.ACTIVE);
    // bcrypt hash, not the plaintext
    expect(typeof accountPayload.password).toBe('string');
    expect(accountPayload.password.length).toBeGreaterThan(20);
  });

  it('rejects a duplicate email and creates no records', async () => {
    accountModel.exists.mockResolvedValue({ _id: 'existing' });

    const res = await service.createWithAccount(baseDto() as any);

    expect(res.code).toBe(rc.ERROR);
    expect(profileModel.create).not.toHaveBeenCalled();
    expect(accountModel.create).not.toHaveBeenCalled();
    expect(doctorModel.create).not.toHaveBeenCalled();
    expect(doctorModel.db.startSession).not.toHaveBeenCalled();
  });

  it('rolls back (no partial records, no leaked response) when a mid-step write fails', async () => {
    doctorModel.create.mockRejectedValue(new Error('doctor insert failed'));

    const res = await service.createWithAccount(baseDto() as any);

    expect(res.code).toBe(rc.ERROR);
    expect(res.data).toBeNull();
    expect(session.endSession).toHaveBeenCalled();
  });

  it('still succeeds but flags emailSent=false when the credentials mail fails (records stay committed)', async () => {
    mailService.sendAccountCreatedMail.mockRejectedValue(new Error('smtp down'));

    const res = await service.createWithAccount(baseDto() as any);

    expect(res.code).toBe(rc.SUCCESS);
    expect(res.data?.emailSent).toBe(false);
  });
});
