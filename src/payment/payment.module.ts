import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Appointment, AppointmentSchema } from 'src/appointment/schemas/appointment.schema';
import { Billing, BillingSchema } from 'src/billing/billing.schema';
import { Doctor, DoctorSchema } from 'src/doctor/schema/doctor.schema';
import { Patient, PatientSchema } from 'src/patient/schema/patient.schema';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';
import { TimeSlotLog, TimeSlotLogSchema } from 'src/timeslot/schemas/timeslot-log.schema';
import { Visit, VisitSchema } from 'src/visit/schemas/visit.schema';
import { CoinSpendAllocation, CoinSpendAllocationSchema } from 'src/wallet/coin/schemas/coin-spend-allocation.schema';
import { CoinTransaction, CoinTransactionSchema } from 'src/wallet/coin/schemas/coin-transaction.schema';
import { CoinWallet, CoinWalletSchema } from 'src/wallet/coin/schemas/coin-wallet.schema';
import { CreditTransaction, CreditTransactionSchema } from 'src/wallet/credit/schemas/credit-transaction.schema';
import { CreditWallet, CreditWalletSchema } from 'src/wallet/credit/schemas/credit-wallet.schema';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { VnPayPaymentController } from './vnpay/vnpay-payment.controller';
import { VnPayPaymentService } from './vnpay/vnpay-payment.service';

@Module({
        imports: [
            MongooseModule.forFeature([
                { name: Payment.name, schema: PaymentSchema },
                { name: Appointment.name, schema: AppointmentSchema },
                { name: Billing.name, schema: BillingSchema },
                { name: Visit.name, schema: VisitSchema },
                { name: TimeSlotLog.name, schema: TimeSlotLogSchema },
                { name: Patient.name, schema: PatientSchema },
                { name: Doctor.name, schema: DoctorSchema },
                { name: Profile.name, schema: ProfileSchema },
                { name: CreditWallet.name, schema: CreditWalletSchema },
                { name: CreditTransaction.name, schema: CreditTransactionSchema },
                { name: CoinWallet.name, schema: CoinWalletSchema },
                { name: CoinTransaction.name, schema: CoinTransactionSchema },
                { name: CoinSpendAllocation.name, schema: CoinSpendAllocationSchema },
            ]),
        ],
        controllers: [PaymentController, VnPayPaymentController],
    providers: [PaymentService, VnPayPaymentService],
    exports: [PaymentService]
})
export class PaymentModule {}
