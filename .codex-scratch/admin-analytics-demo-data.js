const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const MARKER = 'ADMIN_ANALYTICS_DEMO_SEED_2026_07_11';
const BOOST_MARKER = 'ADMIN_ANALYTICS_DEMO_TOP_RATED_BOOST_2026_07_11';
const mode = process.argv[2] || 'inspect';

function readEnvValue(key) {
  const envPath = path.resolve(process.cwd(), '.env');
  const raw = fs.readFileSync(envPath, 'utf8');
  const line = raw
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}=`));
  if (!line) {
    throw new Error(`${key} not found in .env`);
  }
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
}

function assertLocalMongo(uri) {
  if (/mongodb\+srv/i.test(uri) || /prod|production|staging|atlas|cloud/i.test(uri)) {
    throw new Error(`Refusing non-local/prod-like Mongo URI: ${uri}`);
  }
  const parsed = new URL(uri);
  const hosts = parsed.host.split(',');
  const local = hosts.every((host) => {
    const name = host.split(':')[0].toLowerCase();
    return name === 'localhost' || name === '127.0.0.1' || name === '::1';
  });
  if (!local) {
    throw new Error(`Refusing Mongo URI with non-local host(s): ${uri}`);
  }
  const dbName = parsed.pathname.replace(/^\//, '');
  if (!dbName || /prod|production|staging/i.test(dbName)) {
    throw new Error(`Refusing prod-like or missing Mongo database name: ${dbName}`);
  }
}

const anySchema = (timestamps = false) =>
  new mongoose.Schema({}, { strict: false, timestamps, collection: undefined });

const Account = mongoose.model('AccountSeed', anySchema(true), 'accounts');
const Appointment = mongoose.model('AppointmentSeed', anySchema(true), 'appointments');
const ChuyenKhoa = mongoose.model('ChuyenKhoaSeed', anySchema(true), 'chuyenkhoas');
const Doctor = mongoose.model('DoctorSeed', anySchema(true), 'doctors');
const Patient = mongoose.model('PatientSeed', anySchema(false), 'patients');
const Profile = mongoose.model('ProfileSeed', anySchema(true), 'profiles');
const Review = mongoose.model('ReviewSeed', anySchema(true), 'reviews');

function scheduledWindow(now = Date.now()) {
  const fromDate = new Date(now);
  fromDate.setMonth(fromDate.getMonth() - 3);
  return { from: fromDate.getTime(), to: now };
}

function windowMatch(field, window) {
  const match = {};
  if (window.from !== null && window.from !== undefined) match.$gte = window.from;
  if (window.to !== null && window.to !== undefined) match.$lte = window.to;
  return Object.keys(match).length ? { [field]: match } : {};
}

async function topSpecialties(limit = 10) {
  const window = scheduledWindow();
  const [facet = {}] = await Appointment.aggregate([
    { $match: { appointmentStatus: 'COMPLETED', ...windowMatch('scheduledAt', window) } },
    { $lookup: { from: 'doctors', localField: 'doctorId', foreignField: '_id', as: 'doctor' } },
    { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
    { $addFields: { specialtyKey: { $ifNull: ['$doctor.chuyenKhoaId', '$specialtyId'] } } },
    {
      $facet: {
        ranked: [
          { $match: { specialtyKey: { $ne: null } } },
          { $group: { _id: '$specialtyKey', examCount: { $sum: 1 } } },
          { $sort: { examCount: -1 } },
          { $limit: limit },
          { $lookup: { from: 'chuyenkhoas', localField: '_id', foreignField: '_id', as: 'ck' } },
          { $unwind: { path: '$ck', preserveNullAndEmptyArrays: true } },
          { $project: { _id: 0, specialtyId: { $toString: '$_id' }, name: '$ck.name', examCount: 1 } },
        ],
        unattributed: [{ $match: { specialtyKey: null } }, { $count: 'count' }],
      },
    },
  ]);
  return { window, items: facet.ranked || [], unattributedCount: facet.unattributed?.[0]?.count || 0 };
}

async function topDoctors(limit = 10) {
  const window = scheduledWindow();
  const items = await Appointment.aggregate([
    { $match: { appointmentStatus: 'COMPLETED', doctorId: { $ne: null }, ...windowMatch('scheduledAt', window) } },
    { $group: { _id: '$doctorId', examCount: { $sum: 1 } } },
    { $sort: { examCount: -1 } },
    { $limit: limit },
    { $lookup: { from: 'doctors', localField: '_id', foreignField: '_id', as: 'doctor' } },
    { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'profiles', localField: 'doctor.profileId', foreignField: '_id', as: 'profile' } },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    { $project: { _id: 0, doctorId: { $toString: '$_id' }, doctorName: '$profile.name', examCount: 1 } },
  ]);
  return { window, items };
}

async function topRatedDoctors(limit = 10) {
  const items = await Review.aggregate([
    { $group: { _id: '$doctorId', avgRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } },
    { $sort: { avgRating: -1, reviewCount: -1 } },
    { $limit: limit },
    { $lookup: { from: 'doctors', localField: '_id', foreignField: '_id', as: 'doctor' } },
    { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'profiles', localField: 'doctor.profileId', foreignField: '_id', as: 'profile' } },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        doctorId: { $toString: '$_id' },
        doctorName: '$profile.name',
        avgRating: { $round: ['$avgRating', 2] },
        reviewCount: 1,
      },
    },
  ]);
  return { window: null, items };
}

async function frequentPatients(limit = 10) {
  const window = scheduledWindow();
  const rows = await Appointment.aggregate([
    { $match: { appointmentStatus: 'COMPLETED', patientId: { $ne: null }, ...windowMatch('scheduledAt', window) } },
    { $group: { _id: '$patientId', examCount: { $sum: 1 } } },
    { $sort: { examCount: -1 } },
    { $limit: limit },
    { $lookup: { from: 'patients', localField: '_id', foreignField: '_id', as: 'patient' } },
    { $unwind: { path: '$patient', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'profiles', localField: 'patient.profileId', foreignField: '_id', as: 'profile' } },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'accounts', localField: 'patient.accountId', foreignField: '_id', as: 'account' } },
    { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        patientId: { $toString: '$_id' },
        accountId: { $toString: '$patient.accountId' },
        name: '$profile.name',
        status: '$account.status',
        examCount: 1,
      },
    },
  ]);
  return { window, items: rows };
}

async function inspect() {
  const window = scheduledWindow();
  const counts = {
    accounts: await Account.countDocuments(),
    patients: await Patient.countDocuments(),
    doctors: await Doctor.countDocuments(),
    specialties: await ChuyenKhoa.countDocuments(),
    appointments: await Appointment.countDocuments(),
    completedAppointments: await Appointment.countDocuments({ appointmentStatus: 'COMPLETED' }),
    completedAppointmentsInDefaultWindow: await Appointment.countDocuments({
      appointmentStatus: 'COMPLETED',
      ...windowMatch('scheduledAt', window),
    }),
    reviews: await Review.countDocuments(),
  };

  const patientConvention = await Appointment.aggregate([
    { $match: { patientId: { $ne: null } } },
    { $group: { _id: '$patientId', appointments: { $sum: 1 } } },
    { $lookup: { from: 'patients', localField: '_id', foreignField: '_id', as: 'patient' } },
    { $lookup: { from: 'accounts', localField: '_id', foreignField: '_id', as: 'account' } },
    {
      $group: {
        _id: null,
        distinctPatientIds: { $sum: 1 },
        resolvesAsPatient: { $sum: { $cond: [{ $gt: [{ $size: '$patient' }, 0] }, 1, 0] } },
        resolvesAsAccount: { $sum: { $cond: [{ $gt: [{ $size: '$account' }, 0] }, 1, 0] } },
      },
    },
  ]);

  const doctorsBySpecialty = await Doctor.aggregate([
    { $lookup: { from: 'profiles', localField: 'profileId', foreignField: '_id', as: 'profile' } },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'chuyenkhoas', localField: 'chuyenKhoaId', foreignField: '_id', as: 'specialty' } },
    { $unwind: { path: '$specialty', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        doctorId: { $toString: '$_id' },
        doctorName: '$profile.name',
        chuyenKhoaId: { $toString: '$chuyenKhoaId' },
        specialtyName: '$specialty.name',
      },
    },
    { $sort: { doctorName: 1 } },
  ]);

  return {
    connection: { uri: readEnvValue('MONGO_DB_URI'), dbName: mongoose.connection.name },
    counts,
    patientConvention: patientConvention[0] || {
      distinctPatientIds: 0,
      resolvesAsPatient: 0,
      resolvesAsAccount: 0,
    },
    doctorChuyenKhoa: {
      totalDoctors: doctorsBySpecialty.length,
      populated: doctorsBySpecialty.filter((d) => d.chuyenKhoaId).length,
      rows: doctorsBySpecialty,
    },
    currentLeaderboards: {
      topSpecialties: await topSpecialties(10),
      topDoctors: await topDoctors(10),
      topRatedDoctors: await topRatedDoctors(10),
      frequentPatients: await frequentPatients(10),
    },
    existingSeedMarkerAppointments: await Appointment.countDocuments({ reasonForAppointment: { $regex: MARKER } }),
    existingSeedMarkerReviews: await Review.countDocuments({ comment: { $regex: MARKER } }),
  };
}

function pickDoctors(doctors, wanted) {
  const picked = [];
  const usedSpecialties = new Set();
  for (const doctor of doctors) {
    const specialtyKey = String(doctor.chuyenKhoaId || '');
    if (!specialtyKey || usedSpecialties.has(specialtyKey)) continue;
    picked.push(doctor);
    usedSpecialties.add(specialtyKey);
    if (picked.length === wanted) return picked;
  }
  for (const doctor of doctors) {
    if (!picked.some((d) => String(d._id) === String(doctor._id)) && doctor.chuyenKhoaId) {
      picked.push(doctor);
      if (picked.length === wanted) return picked;
    }
  }
  return picked;
}

async function seed() {
  const existingMarkerCount = await Appointment.countDocuments({ reasonForAppointment: { $regex: MARKER } });
  if (existingMarkerCount > 0) {
    throw new Error(`Seed marker already exists on ${existingMarkerCount} appointments; refusing to double-seed.`);
  }

  const doctors = await Doctor.aggregate([
    { $match: { chuyenKhoaId: { $ne: null } } },
    { $lookup: { from: 'profiles', localField: 'profileId', foreignField: '_id', as: 'profile' } },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    { $sort: { 'profile.name': 1 } },
  ]);
  const pickedDoctors = pickDoctors(doctors, 6);
  if (pickedDoctors.length < 5) {
    throw new Error(`Need at least 5 reusable doctors with specialties; found ${pickedDoctors.length}.`);
  }

  const now = Date.now();
  const demoPatients = [
    { name: 'Nguyen Minh Anh', email: 'analytics.demo.minh.anh@local.test', status: 'ACTIVE', count: 54 },
    { name: 'Tran Quoc Bao', email: 'analytics.demo.quoc.bao@local.test', status: 'ACTIVE', count: 46 },
    { name: 'Le Hoang Lan', email: 'analytics.demo.hoang.lan@local.test', status: 'ACTIVE', count: 36 },
    { name: 'Pham Gia Huy', email: 'analytics.demo.gia.huy@local.test', status: 'INACTIVE', count: 26 },
    { name: 'Do Thao Vy', email: 'analytics.demo.thao.vy@local.test', status: 'ACTIVE', count: 18 },
  ];

  const password = await bcrypt.hash('AdminAnalyticsDemo123!', 10);
  const profiles = await Profile.insertMany(
    demoPatients.map((patient, index) => ({
      name: patient.name,
      address: `Demo district ${index + 1}, Ho Chi Minh City`,
      phone: `09000010${index}`,
      email: patient.email,
      gender: index % 2 === 0 ? 'MALE' : 'FEMALE',
      dob: new Date(Date.UTC(1990 + index, index, 10 + index)),
      avatarUrl: '',
    })),
  );
  const accounts = await Account.insertMany(
    demoPatients.map((patient, index) => ({
      profileId: profiles[index]._id,
      role: 'PATIENT',
      email: patient.email,
      password,
      status: patient.status,
      refreshToken: '',
      accessToken: '',
      otp: null,
      otpCreatedAt: null,
      otpExpiredAt: null,
    })),
  );
  const patients = await Patient.insertMany(
    demoPatients.map((_patient, index) => ({
      profileId: profiles[index]._id,
      accountId: accounts[index]._id,
      height: 158 + index * 4,
      weight: 52 + index * 5,
      bloodType: ['A', 'B', 'O', 'AB', 'A'][index],
    })),
  );

  const doctorCounts = [48, 41, 35, 28, 20, 8];
  const patientSchedule = demoPatients.flatMap((patient, index) => Array(patient.count).fill(index));
  const appointmentDocs = [];
  let serial = 0;
  for (let d = 0; d < pickedDoctors.length; d += 1) {
    const doctor = pickedDoctors[d];
    for (let i = 0; i < doctorCounts[d]; i += 1) {
      const patientIndex = patientSchedule[serial % patientSchedule.length];
      const dayOffset = 5 + ((serial * 3) % 82);
      const scheduledAt = now - dayOffset * 24 * 60 * 60 * 1000 + (8 + (serial % 8)) * 60 * 60 * 1000;
      appointmentDocs.push({
        date: scheduledAt,
        scheduledAt,
        bookingDate: scheduledAt - (3 + (serial % 7)) * 24 * 60 * 60 * 1000,
        startTime: scheduledAt,
        endTime: scheduledAt + 30 * 60 * 1000,
        appointmentStatus: 'COMPLETED',
        serviceType: 'KHAM_DICH_VU',
        consultationFee: 200000 + d * 25000,
        paymentCategory: 'DICH_VU',
        depositAmount: 0,
        depositStatus: 'NOT_REQUIRED',
        depositPaidAmount: 0,
        coinDiscountAmount: 0,
        paymentAmount: 200000 + d * 25000,
        paidAt: new Date(scheduledAt),
        paymentResponseCode: '00',
        paymentTransactionStatus: '00',
        patientId: patients[patientIndex]._id,
        patientEmail: accounts[patientIndex].email,
        doctorId: doctor._id,
        reasonForAppointment: `${MARKER} recent exam ${serial + 1}`,
        specialtyId: doctor.chuyenKhoaId,
        paymentMethod: 'CASH',
        hospitalName: 'UTE Doctor Demo Clinic',
        assignmentStatus: 'NONE',
      });
      serial += 1;
    }
  }

  for (let i = 0; i < 4; i += 1) {
    const doctor = pickedDoctors[i % pickedDoctors.length];
    const patient = patients[i % patients.length];
    const account = accounts[i % accounts.length];
    const scheduledAt = now - (125 + i * 7) * 24 * 60 * 60 * 1000;
    appointmentDocs.push({
      date: scheduledAt,
      scheduledAt,
      bookingDate: scheduledAt - 5 * 24 * 60 * 60 * 1000,
      startTime: scheduledAt,
      endTime: scheduledAt + 30 * 60 * 1000,
      appointmentStatus: 'COMPLETED',
      serviceType: 'KHAM_DICH_VU',
      consultationFee: 200000,
      paymentCategory: 'DICH_VU',
      depositAmount: 0,
      depositStatus: 'NOT_REQUIRED',
      depositPaidAmount: 0,
      coinDiscountAmount: 0,
      paymentAmount: 200000,
      paidAt: new Date(scheduledAt),
      paymentResponseCode: '00',
      paymentTransactionStatus: '00',
      patientId: patient._id,
      patientEmail: account.email,
      doctorId: doctor._id,
      reasonForAppointment: `${MARKER} older-outside-window ${i + 1}`,
      specialtyId: doctor.chuyenKhoaId,
      paymentMethod: 'CASH',
      hospitalName: 'UTE Doctor Demo Clinic',
      assignmentStatus: 'NONE',
    });
  }

  const appointments = await Appointment.insertMany(appointmentDocs);
  const ratingsByDoctor = [
    [10, 10, 10, 9, 9, 10],
    [9, 9, 9, 9, 8, 8, 9, 9],
    [9, 9, 8, 8, 8, 9],
    [8, 8, 7, 8, 7],
    [7, 7, 6, 7],
    [6, 6, 5],
  ];
  const recentAppointments = appointments.filter((appt) => appt.reasonForAppointment.includes('recent exam'));
  const reviewDocs = [];
  let apptCursor = 0;
  for (let d = 0; d < ratingsByDoctor.length; d += 1) {
    for (let r = 0; r < ratingsByDoctor[d].length; r += 1) {
      const appointment = recentAppointments.find((appt, idx) => idx >= apptCursor && String(appt.doctorId) === String(pickedDoctors[d]._id));
      if (!appointment) continue;
      apptCursor = recentAppointments.indexOf(appointment) + 1;
      const createdAt = new Date(now - (12 + (d * 11 + r * 5)) * 24 * 60 * 60 * 1000);
      reviewDocs.push({
        doctorId: pickedDoctors[d]._id,
        patientId: appointment.patientId,
        appointmentId: appointment._id,
        rating: ratingsByDoctor[d][r],
        comment: `${MARKER} review ${d + 1}.${r + 1}`,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }
  const reviews = await Review.insertMany(reviewDocs);

  return {
    inserted: {
      profiles: profiles.length,
      accounts: accounts.length,
      patients: patients.length,
      appointments: appointments.length,
      recentAppointments: appointments.length - 4,
      olderOutsideWindowAppointments: 4,
      reviews: reviews.length,
    },
    selectedDoctors: pickedDoctors.map((doctor, index) => ({
      doctorId: String(doctor._id),
      doctorName: doctor.profile?.name,
      specialtyId: String(doctor.chuyenKhoaId),
      plannedRecentAppointments: doctorCounts[index],
      plannedReviews: ratingsByDoctor[index].length,
    })),
    demoPatients: patients.map((patient, index) => ({
      patientId: String(patient._id),
      accountId: String(accounts[index]._id),
      name: demoPatients[index].name,
      plannedRecentAppointmentsApprox: demoPatients[index].count,
    })),
  };
}

async function boostTopRated() {
  const existingBoostCount = await Review.countDocuments({ comment: { $regex: BOOST_MARKER } });
  if (existingBoostCount > 0) {
    throw new Error(`Boost marker already exists on ${existingBoostCount} reviews; refusing to double-boost.`);
  }

  const demoAccount = await Account.findOne({ email: 'analytics.demo.minh.anh@local.test' }).lean();
  if (!demoAccount) throw new Error('Demo patient account not found; run seed first.');
  const demoPatient = await Patient.findOne({ accountId: demoAccount._id }).lean();
  if (!demoPatient) throw new Error('Demo patient not found; run seed first.');

  const reviewedDoctorIds = await Review.distinct('doctorId');
  const [doctor] = await Doctor.aggregate([
    { $match: { chuyenKhoaId: { $ne: null }, _id: { $nin: reviewedDoctorIds } } },
    { $lookup: { from: 'profiles', localField: 'profileId', foreignField: '_id', as: 'profile' } },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    { $sort: { 'profile.name': 1 } },
    { $limit: 1 },
  ]);
  if (!doctor) throw new Error('No unused doctor without reviews found for top-rated boost.');

  const now = Date.now();
  const appointmentDocs = Array.from({ length: 6 }, (_unused, index) => {
    const scheduledAt = now - (9 + index * 4) * 24 * 60 * 60 * 1000 + 10 * 60 * 60 * 1000;
    return {
      date: scheduledAt,
      scheduledAt,
      bookingDate: scheduledAt - 4 * 24 * 60 * 60 * 1000,
      startTime: scheduledAt,
      endTime: scheduledAt + 30 * 60 * 1000,
      appointmentStatus: 'COMPLETED',
      serviceType: 'KHAM_DICH_VU',
      consultationFee: 240000,
      paymentCategory: 'DICH_VU',
      depositAmount: 0,
      depositStatus: 'NOT_REQUIRED',
      depositPaidAmount: 0,
      coinDiscountAmount: 0,
      paymentAmount: 240000,
      paidAt: new Date(scheduledAt),
      paymentResponseCode: '00',
      paymentTransactionStatus: '00',
      patientId: demoPatient._id,
      patientEmail: demoAccount.email,
      doctorId: doctor._id,
      reasonForAppointment: `${BOOST_MARKER} recent exam ${index + 1}`,
      specialtyId: doctor.chuyenKhoaId,
      paymentMethod: 'CASH',
      hospitalName: 'UTE Doctor Demo Clinic',
      assignmentStatus: 'NONE',
    };
  });
  const appointments = await Appointment.insertMany(appointmentDocs);
  const reviewDocs = appointments.map((appointment, index) => {
    const createdAt = new Date(now - (7 + index * 3) * 24 * 60 * 60 * 1000);
    return {
      doctorId: doctor._id,
      patientId: demoPatient._id,
      appointmentId: appointment._id,
      rating: 10,
      comment: `${BOOST_MARKER} review ${index + 1}`,
      createdAt,
      updatedAt: createdAt,
    };
  });
  const reviews = await Review.insertMany(reviewDocs);
  return {
    inserted: { appointments: appointments.length, reviews: reviews.length },
    selectedDoctor: {
      doctorId: String(doctor._id),
      doctorName: doctor.profile?.name,
      specialtyId: String(doctor.chuyenKhoaId),
    },
    patientId: String(demoPatient._id),
  };
}

async function verify() {
  const window = scheduledWindow();
  return {
    connection: { uri: readEnvValue('MONGO_DB_URI'), dbName: mongoose.connection.name },
    markerCounts: {
      profiles: await Profile.countDocuments({ email: { $regex: 'analytics.demo.' } }),
      accounts: await Account.countDocuments({ email: { $regex: 'analytics.demo.' } }),
      patients: await Patient.countDocuments({
        accountId: { $in: await Account.distinct('_id', { email: { $regex: 'analytics.demo.' } }) },
      }),
      appointments: await Appointment.countDocuments({ reasonForAppointment: { $regex: MARKER } }),
      recentAppointmentsInDefaultWindow: await Appointment.countDocuments({
        reasonForAppointment: { $regex: `${MARKER} recent exam` },
        ...windowMatch('scheduledAt', window),
      }),
      olderOutsideWindowAppointmentsTotal: await Appointment.countDocuments({
        reasonForAppointment: { $regex: `${MARKER} older-outside-window` },
      }),
      olderOutsideWindowAppointmentsInDefaultWindow: await Appointment.countDocuments({
        reasonForAppointment: { $regex: `${MARKER} older-outside-window` },
        ...windowMatch('scheduledAt', window),
      }),
      reviews: await Review.countDocuments({ comment: { $regex: MARKER } }),
      boostAppointments: await Appointment.countDocuments({ reasonForAppointment: { $regex: BOOST_MARKER } }),
      boostReviews: await Review.countDocuments({ comment: { $regex: BOOST_MARKER } }),
    },
    leaderboards: {
      topSpecialties: await topSpecialties(10),
      topDoctors: await topDoctors(10),
      topRatedDoctors: await topRatedDoctors(10),
      frequentPatients: await frequentPatients(10),
    },
  };
}

async function main() {
  const uri = readEnvValue('MONGO_DB_URI');
  assertLocalMongo(uri);
  await mongoose.connect(uri);
  let output;
  if (mode === 'inspect') output = await inspect();
  else if (mode === 'seed') output = await seed();
  else if (mode === 'boost-rated') output = await boostTopRated();
  else if (mode === 'verify') output = await verify();
  else throw new Error(`Unknown mode: ${mode}`);
  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
