const dateKey = (year: number, monthIndex: number, day: number) =>
  `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const observedHolidayKey = (year: number, monthIndex: number, day: number) => {
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return dateKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const nthWeekdayOfMonth = (year: number, monthIndex: number, weekday: number, nth: number) => {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const day = 1 + (weekday - first.getUTCDay() + 7) % 7 + (nth - 1) * 7;
  return new Date(Date.UTC(year, monthIndex, day));
};

const lastWeekdayOfMonth = (year: number, monthIndex: number, weekday: number) => {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  last.setUTCDate(last.getUTCDate() - (last.getUTCDay() - weekday + 7) % 7);
  return last;
};

const easterSunday = (year: number) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monthIndex = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(Date.UTC(year, monthIndex, day));
};

const keyFromDate = (date: Date) =>
  dateKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

export const getFullMarketHolidayKeys = (year: number) => {
  const holidays = new Set<string>();
  const addDate = (date: Date) => holidays.add(keyFromDate(date));

  holidays.add(observedHolidayKey(year, 0, 1));
  holidays.add(observedHolidayKey(year + 1, 0, 1));
  addDate(nthWeekdayOfMonth(year, 0, 1, 3));
  addDate(nthWeekdayOfMonth(year, 1, 1, 3));

  const goodFriday = easterSunday(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  addDate(goodFriday);

  addDate(lastWeekdayOfMonth(year, 4, 1));
  if (year >= 2022) holidays.add(observedHolidayKey(year, 5, 19));
  holidays.add(observedHolidayKey(year, 6, 4));
  addDate(nthWeekdayOfMonth(year, 8, 1, 1));
  addDate(nthWeekdayOfMonth(year, 10, 4, 4));
  holidays.add(observedHolidayKey(year, 11, 25));
  return holidays;
};

export const getEarlyCloseMarketHolidayKeys = (
  year: number,
  fullHolidayKeys = getFullMarketHolidayKeys(year),
) => {
  const earlyCloses = new Set<string>();
  const addIfTradingDay = (date: Date) => {
    const key = keyFromDate(date);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !fullHolidayKeys.has(key)) earlyCloses.add(key);
  };

  addIfTradingDay(new Date(Date.UTC(year, 6, 3)));
  const dayAfterThanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);
  dayAfterThanksgiving.setUTCDate(dayAfterThanksgiving.getUTCDate() + 1);
  addIfTradingDay(dayAfterThanksgiving);
  addIfTradingDay(new Date(Date.UTC(year, 11, 24)));
  return earlyCloses;
};

export const isNyseTradingDay = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || keyFromDate(date) !== value) return false;
  if (date.getUTCDay() === 0 || date.getUTCDay() === 6) return false;
  return !getFullMarketHolidayKeys(date.getUTCFullYear()).has(value);
};
