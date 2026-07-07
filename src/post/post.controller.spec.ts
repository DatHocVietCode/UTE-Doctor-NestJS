import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { DoctorPostController } from './post.controller';

describe('DoctorPostController create', () => {
  let controller: DoctorPostController;
  let doctorPostService: {
    create: jest.MockedFunction<(
      dto: any,
      file?: Express.Multer.File,
    ) => Promise<{ status: boolean }> >;
  };

  beforeEach(() => {
    doctorPostService = {
      create: jest.fn(async () => ({ status: true })) as any,
    };

    controller = new DoctorPostController(doctorPostService as any);
  });

  it('accepts a multipart video field named video', async () => {
    const videoFile = {
      buffer: Buffer.from('video-bytes'),
      mimetype: 'video/mp4',
    } as Express.Multer.File;

    await controller.create(
      { user: { doctorId: 'doctor-1' } },
      { title: 'My post', description: 'Demo' },
      { video: [videoFile] },
    );

    expect(doctorPostService.create).toHaveBeenCalledWith(
      { title: 'My post', description: 'Demo', doctorId: 'doctor-1' },
      videoFile,
    );
  });

  it('rejects requests that do not include a doctor identity', async () => {
    expect(() =>
      controller.create({ user: {} }, { title: 'My post' }, {}),
    ).toThrow(UnauthorizedException);
  });
});