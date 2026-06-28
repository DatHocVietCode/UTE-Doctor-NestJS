import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AppointmentStatus } from 'src/appointment/enums/Appointment-status.enum';
import { Appointment, AppointmentDocument } from 'src/appointment/schemas/appointment.schema';
import { BillingService } from 'src/billing/billing.service';
import { PaymentService } from 'src/payment/payment.service';
import { Account, AccountDocument } from 'src/account/schemas/account.schema';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { MailService } from 'src/mail/mail.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { StaffCreationResponse } from 'src/common/dto/staff-creation-response';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { RoleEnum } from 'src/common/enum/role.enum';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';
import { DateTimeHelper } from 'src/utils/helpers/datetime.helper';
import { CreateReceptionistDto } from './dto/create-receptionist.dto';
import { ListReceptionistQueryDto } from './dto/list-receptionist.query.dto';
import { ReceptionistListItem, ReceptionistListResponse } from './dto/receptionist-list-item.dto';
import { Receptionist, ReceptionistDocument } from './schema/receptionist.schema';

type MockPaymentInput = {
	visitId?: string;
	amount?: number;
};

@Injectable()
export class ReceptionistService {
	constructor(
		@InjectModel(Appointment.name)
		private readonly appointmentModel: Model<AppointmentDocument>,
		@InjectModel(Account.name)
		private readonly accountModel: Model<AccountDocument>,
		@InjectModel(Profile.name)
		private readonly profileModel: Model<ProfileDocument>,
		@InjectModel(Receptionist.name)
		private readonly receptionistModel: Model<ReceptionistDocument>,
		private readonly billingService: BillingService,
		private readonly paymentService: PaymentService,
		private readonly mailService: MailService,
		private readonly cloudinaryService: CloudinaryService,
	) {}

	// Admin-only provisioning: creates the full Account -> Profile -> Receptionist chain
	// atomically (Mongo transaction). The account is created ACTIVE so the receptionist
	// can log in immediately with the emailed credentials.
	async createWithAccount(
		createReceptionistDto: CreateReceptionistDto,
		avatar?: Express.Multer.File,
	): Promise<DataResponse<StaffCreationResponse>> {
		const dataRes: DataResponse<StaffCreationResponse> = { code: rc.PENDING, message: '', data: null };

		const email = createReceptionistDto.profile?.email;
		if (!email) {
			return { code: rc.ERROR, message: 'Receptionist email is required', data: null };
		}

		// Fail fast with a clean message on duplicate email; the unique email index is the
		// race-safe backstop (a concurrent insert throws inside the transaction -> rollback).
		const exists = await this.accountModel.exists({ email });
		if (exists) {
			return { code: rc.ERROR, message: 'Account with this email already exists', data: null };
		}

		// Upload avatar (external side effect) BEFORE opening the transaction.
		let uploadedAvatarUrl: string | undefined;
		if (avatar) {
			uploadedAvatarUrl = await this.cloudinaryService.uploadFileBuffer(
				avatar.buffer,
				avatar.mimetype,
				'profiles',
			);
		}

		const rawPassword = crypto.randomBytes(6).toString('hex');
		const hashed = await bcrypt.hash(rawPassword, 10);

		// Assigned inside the transaction closure; the success path below only runs if the
		// transaction committed without throwing (definite-assignment via `!`).
		let profileDoc!: ProfileDocument;
		let accountDoc!: AccountDocument;
		let savedReceptionist!: ReceptionistDocument;

		const session = await this.receptionistModel.db.startSession();
		try {
			await session.withTransaction(async () => {
				const [profile] = await this.profileModel.create(
					[
						{
							name: createReceptionistDto.profile.name,
							address: createReceptionistDto.profile.address ?? '',
							phone: createReceptionistDto.profile.phone ?? '',
							email: createReceptionistDto.profile.email,
							gender: createReceptionistDto.profile.gender ?? '',
							dob: createReceptionistDto.profile.dob ? DateTimeHelper.toUtcDate(createReceptionistDto.profile.dob) : null,
							avatarUrl: uploadedAvatarUrl ?? createReceptionistDto.profile.avatarUrl ?? '',
						},
					],
					{ session },
				);
				profileDoc = profile;

				const [account] = await this.accountModel.create(
					[
						{
							email,
							password: hashed,
							role: RoleEnum.RECEPTIONIST,
							profileId: profile._id,
							status: AccountStatusEnum.ACTIVE,
						},
					],
					{ session },
				);
				accountDoc = account;

				const [receptionist] = await this.receptionistModel.create(
					[
						{
							profileId: profile._id,
							accountId: account._id,
							hospitalName: createReceptionistDto.hospitalName ?? undefined,
						},
					],
					{ session },
				);
				savedReceptionist = receptionist;
			});
		} catch (error: any) {
			// Transaction auto-rolled back — no partial Account/Profile/Receptionist records remain.
			console.error('[ReceptionistService] createWithAccount transaction failed:', error?.message);
			return { code: rc.ERROR, message: error?.message || 'Error creating receptionist', data: null };
		} finally {
			await session.endSession();
		}

		const profile = profileDoc;
		const account = accountDoc;
		const receptionist = savedReceptionist;

		// Records are committed. Email the credentials best-effort: a mail failure must NOT
		// roll back the DB records (admin can resend / reset later).
		let emailSent = true;
		try {
			await this.mailService.sendAccountCreatedMail({
				toEmail: email,
				password: rawPassword,
				role: RoleEnum.RECEPTIONIST,
			});
		} catch (mailErr: any) {
			emailSent = false;
			console.error('[ReceptionistService] Failed to send account-created mail:', mailErr?.message);
		}

		dataRes.code = rc.SUCCESS;
		dataRes.message = 'Receptionist created successfully';
		dataRes.data = {
			account: {
				id: account._id.toString(),
				email: account.email,
				role: account.role,
				status: account.status,
			},
			profile: {
				id: profile._id.toString(),
				fullName: profile.name,
				phone: profile.phone,
			},
			receptionist: {
				id: receptionist._id.toString(),
			},
			emailSent,
		};
		return dataRes;
	}

	// Admin-only: paginated receptionist list for the Admin UI. Joined Receptionist -> Profile
	// + Account and mapped to a clean DTO (no password/hash). The dataset is small (staff), so
	// we load + map then paginate in-memory, which also lets search span the joined fields.
	async listReceptionists(query: ListReceptionistQueryDto): Promise<DataResponse<ReceptionistListResponse>> {
		const page = Number(query?.page) > 0 ? Number(query.page) : 1;
		const limit = Number(query?.limit) > 0 ? Number(query.limit) : 20;
		const search = (query?.search ?? '').trim().toLowerCase();
		const skip = (page - 1) * limit;

		const docs = await this.receptionistModel
			.find()
			.sort({ createdAt: -1 })
			.populate('profileId')
			.populate('accountId')
			.lean()
			.exec();

		const mapped = (docs as any[]).map((doc) => this.toReceptionistListItem(doc));

		const filtered = search
			? mapped.filter(
					(r) =>
						(r.fullName ?? '').toLowerCase().includes(search) ||
						(r.email ?? '').toLowerCase().includes(search),
				)
			: mapped;

		const total = filtered.length;
		const paged = filtered.slice(skip, skip + limit);

		return {
			code: rc.SUCCESS,
			message: 'Fetched receptionists successfully',
			data: {
				receptionists: paged,
				pagination: {
					total,
					page,
					limit,
					totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
				},
			},
		};
	}

	// Null-safe projection of a (lean) Receptionist with populated profile/account into a list
	// row. A dangling ref is populated as `null` by Mongoose, so missing data degrades to
	// empty/null rather than throwing.
	private toReceptionistListItem(doc: any): ReceptionistListItem {
		const isPopulated = (v: any) => v && typeof v === 'object' && !(v instanceof Types.ObjectId);
		const profile = isPopulated(doc?.profileId) ? doc.profileId : null;
		const account = isPopulated(doc?.accountId) ? doc.accountId : null;

		const toMs = (d: any): number | undefined => {
			if (d === null || d === undefined) return undefined;
			const t = new Date(d).getTime();
			return Number.isNaN(t) ? undefined : t;
		};

		const accountId = account?._id
			? account._id.toString()
			: doc?.accountId
				? doc.accountId.toString()
				: null;
		const profileId = profile?._id
			? profile._id.toString()
			: doc?.profileId
				? doc.profileId.toString()
				: null;

		return {
			receptionistId: doc?._id ? doc._id.toString() : '',
			accountId,
			profileId,
			email: account?.email ?? profile?.email ?? '',
			fullName: profile?.name ?? '',
			phone: profile?.phone ?? undefined,
			gender: profile?.gender ?? undefined,
			dateOfBirth: toMs(profile?.dob) ?? null,
			address: profile?.address ?? undefined,
			avatarUrl: profile?.avatarUrl ?? undefined,
			hospitalName: doc?.hospitalName ?? undefined,
			accountStatus: account?.status ?? undefined,
			createdAt: toMs(doc?.createdAt),
			updatedAt: toMs(doc?.updatedAt),
		};
	}

	async getVisits() {
		// Return appointment list for FE receptionist flow integration.
		const visits = await this.appointmentModel
			.find()
			.sort({ createdAt: -1 })
			.limit(50)
			.populate('patientId', 'profileId')
			.populate('doctorId', 'profileId')
			.populate('timeSlot', 'start end label status')
			.lean()
			.exec();

		return {
			code: 'SUCCESS',
			message: 'Fetched receptionist visits successfully',
			data: visits,
		};
	}

	async getBillingByVisitId(visitId: string) {
		console.log('Fetching billing for visitId:', visitId);
		if (!Types.ObjectId.isValid(visitId)) {
			throw new NotFoundException('Visit not found');
		}
		try {
			const billing = await this.billingService.createDraftBilling(visitId);
				return {
					code: 'SUCCESS',
					message: 'Fetched billing successfully',
					data: {
						billingId: billing._id?.toString?.() ?? null,
						visitId: billing.visitId?.toString?.() ?? visitId,
						status: billing.status,
						consultationFee: billing.consultationFee,
						medicationFee: billing.medicationFee,
						totalAmount: billing.totalAmount,
						insuranceAmount: billing.insuranceAmount,
						depositUsed: billing.depositUsed,
						creditUsed: billing.creditUsed,
						coinUsed: billing.coinUsed,
						finalPayable: billing.finalPayable,
						paymentCategory: billing.paymentCategory ?? null,
						// Expose the immutable billing medication snapshot so the receptionist UI uses the same prices used for totals.
						medications: billing.medications.map(med => ({
							medicineId: med.medicineId?.toString() ?? null,
							medicineName: med.medicineName,
							prescribedQty: med.prescribedQty,
							dispensedQty: med.dispensedQty,
							unitPrice: med.unitPrice,
							source: med.source,
							lineTotal: med.lineTotal,
						})),
					},
				};
			} catch (err) {
				throw new NotFoundException('Visit not found');
			}
	}
	

	async mockPayment(input: MockPaymentInput) {
		if (!input.visitId) {
			return {
				code: 'SUCCESS',
				message: 'Mock payment simulated',
				data: {
					visitId: null,
					status: 'COMPLETED',
					amount: Math.max(0, Math.floor(input.amount ?? 0)),
					simulated: true,
				},
			};
		}

		if (!Types.ObjectId.isValid(input.visitId)) {
			throw new NotFoundException('Visit not found');
		}

		const visit = await this.appointmentModel.findById(input.visitId).exec();
		if (!visit) {
			throw new NotFoundException('Visit not found');
		}

		// Temporary FE endpoint: mark pending/failed appointment as paid+confirmed.
		if (
			visit.appointmentStatus === AppointmentStatus.PENDING ||
			visit.appointmentStatus === AppointmentStatus.FAILED
		) {
			visit.appointmentStatus = AppointmentStatus.CONFIRMED;
		}

		const amount = Math.max(
			0,
			Math.floor(
				input.amount ??
					(typeof visit.paymentAmount === 'number'
						? visit.paymentAmount
						: visit.consultationFee ?? 0),
			),
		);

		visit.paymentAmount = amount;
		visit.paidAt = new Date();
		visit.paymentResponseCode = 'MOCK_SUCCESS';
		visit.paymentTransactionStatus = 'MOCK_COMPLETED';
		await visit.save();

		return {
			code: 'SUCCESS',
			message: 'Mock payment completed',
			data: {
				visitId: visit._id.toString(),
				status: visit.appointmentStatus,
				amount,
				paidAt: visit.paidAt,
				simulated: true,
			},
		};
	}

	async applyCreditToBilling(billingId: string, creditToUse: number) {
		if (!Types.ObjectId.isValid(billingId)) {
			throw new NotFoundException('Billing not found');
		}

		if (typeof creditToUse !== 'number' || !Number.isFinite(creditToUse) || creditToUse < 0) {
			throw new BadRequestException('Invalid creditToUse');
		}

		return this.billingService.applyCredit(billingId, creditToUse);
	}

	async applyCoinToBilling(billingId: string, coinToUse: number) {
		if (!Types.ObjectId.isValid(billingId)) {
			throw new NotFoundException('Billing not found');
		}

		if (typeof coinToUse !== 'number' || !Number.isFinite(coinToUse) || coinToUse < 0) {
			throw new BadRequestException('Invalid coinToUse');
		}

		return this.billingService.applyCoin(billingId, coinToUse);
	}

	async finalizeBilling(billingId: string, fulfillment?: { medications: Array<{ medicineId?: string; dispensedQty: number; source: string }> }) {
		if (!Types.ObjectId.isValid(billingId)) {
			throw new NotFoundException('Billing not found');
		}

		return this.billingService.finalizeBilling(billingId, fulfillment as any);
	}

	async getQrPaymentForBilling(billingId: string, ipAddr: string) {
		if (!Types.ObjectId.isValid(billingId)) {
			throw new NotFoundException('Billing not found');
		}

		return this.paymentService.getQrPaymentByBillingId(billingId, ipAddr);
	}

	async markCashPaymentPaid(paymentId: string, performedBy?: string) {
		if (!Types.ObjectId.isValid(paymentId)) {
			throw new NotFoundException('Payment not found');
		}

		return this.paymentService.markPaymentSuccess(paymentId, performedBy, 'CASH');
	}
}
