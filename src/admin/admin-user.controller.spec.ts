import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard } from 'src/common/guards/role.guard';
import { RoleEnum } from 'src/common/enum/role.enum';
import { AdminUserController } from './admin-user.controller';

// The endpoints declare @UseGuards(JwtAuthGuard, RoleGuard) + @Roles(ADMIN). These tests
// verify the authorization contract (admin-only) and that the controller delegates to the
// domain services that own the transactional creation logic.
describe('AdminUserController authorization (admin-only)', () => {
  const makeContext = (user: any): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => AdminUserController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  const adminGuard = () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([RoleEnum.ADMIN]),
    } as unknown as Reflector;
    return new RoleGuard(reflector);
  };

  it('allows an ADMIN', () => {
    expect(adminGuard().canActivate(makeContext({ role: RoleEnum.ADMIN }))).toBe(true);
  });

  it('rejects a RECEPTIONIST', () => {
    expect(() => adminGuard().canActivate(makeContext({ role: RoleEnum.RECEPTIONIST }))).toThrow(ForbiddenException);
  });

  it('rejects a DOCTOR', () => {
    expect(() => adminGuard().canActivate(makeContext({ role: RoleEnum.DOCTOR }))).toThrow(ForbiddenException);
  });

  it('rejects a PATIENT', () => {
    expect(() => adminGuard().canActivate(makeContext({ role: RoleEnum.PATIENT }))).toThrow(ForbiddenException);
  });
});

describe('AdminUserController delegation', () => {
  let controller: AdminUserController;
  let doctorService: any;
  let receptionistService: any;

  beforeEach(() => {
    doctorService = { createWithAccount: jest.fn().mockResolvedValue({ code: 1 }) };
    receptionistService = {
      createWithAccount: jest.fn().mockResolvedValue({ code: 1 }),
      listReceptionists: jest.fn().mockResolvedValue({ code: 1, data: { receptionists: [], pagination: {} } }),
    };
    controller = new AdminUserController(doctorService, receptionistService);
  });

  it('POST /admin/doctors delegates to DoctorService.createWithAccount', async () => {
    const body = { doctorName: 'Dr X', profile: { name: 'Dr X', email: 'x@test.io' } };
    const avatar = { buffer: Buffer.from(''), mimetype: 'image/png' } as any;

    await controller.createDoctor(body, avatar);

    expect(doctorService.createWithAccount).toHaveBeenCalledWith(body, avatar);
  });

  it('POST /admin/receptionists delegates to ReceptionistService.createWithAccount', async () => {
    const body = { profile: { name: 'Anna', email: 'anna@test.io' } };

    await controller.createReceptionist(body, undefined);

    expect(receptionistService.createWithAccount).toHaveBeenCalledWith(body, undefined);
  });

  it('GET /admin/receptionists delegates to ReceptionistService.listReceptionists', async () => {
    const query = { page: 2, limit: 10, search: 'anna' };

    await controller.listReceptionists(query as any);

    expect(receptionistService.listReceptionists).toHaveBeenCalledWith(query);
  });

  it('normalizes multipart string fields (profile/degree/yearsOfExperience) before delegating', async () => {
    const body: any = {
      doctorName: 'Dr Y',
      profile: JSON.stringify({ name: 'Dr Y', email: 'y@test.io' }),
      degree: JSON.stringify(['MD']),
      yearsOfExperience: '7',
    };

    await controller.createDoctor(body, undefined);

    const passed = doctorService.createWithAccount.mock.calls[0][0];
    expect(passed.profile).toEqual({ name: 'Dr Y', email: 'y@test.io' });
    expect(passed.degree).toEqual(['MD']);
    expect(passed.yearsOfExperience).toBe(7);
  });
});
