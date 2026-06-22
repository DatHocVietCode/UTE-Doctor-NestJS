import { TimeHelper } from './time.helper';

describe('TimeHelper.getIanaTimezoneDayRange', () => {
  const now = new Date('2026-06-20T00:30:00.000Z');
  const vietnamStart = Date.parse('2026-06-19T17:00:00.000Z');
  const vietnamEnd = Date.parse('2026-06-20T17:00:00.000Z');

  it('defaults a missing timezone to Asia/Ho_Chi_Minh', () => {
    expect(TimeHelper.getIanaTimezoneDayRange(now)).toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      dateKey: '2026-06-20',
      startEpoch: vietnamStart,
      endEpoch: vietnamEnd,
    });
  });

  it('computes the Vietnam local-day UTC range', () => {
    expect(TimeHelper.getIanaTimezoneDayRange(now, 'Asia/Ho_Chi_Minh')).toEqual(
      {
        timezone: 'Asia/Ho_Chi_Minh',
        dateKey: '2026-06-20',
        startEpoch: vietnamStart,
        endEpoch: vietnamEnd,
      },
    );
  });

  it.each(['', 'Not/A_Timezone'])(
    'falls back for an empty or invalid timezone: %p',
    (timezone) => {
      expect(TimeHelper.getIanaTimezoneDayRange(now, timezone).timezone).toBe(
        'Asia/Ho_Chi_Minh',
      );
    },
  );
});
