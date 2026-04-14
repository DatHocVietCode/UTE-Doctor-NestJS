import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { CreditTransaction, CreditTransactionDocument } from './schemas/credit-transaction.schema';
import { CreditWallet, CreditWalletDocument } from './schemas/credit-wallet.schema';

@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(
    @InjectModel(CreditWallet.name) private readonly creditWalletModel: Model<CreditWalletDocument>,
    @InjectModel(CreditTransaction.name) private readonly creditTransactionModel: Model<CreditTransactionDocument>,
  ) {}

  async getOrCreateCreditWallet(patientId: string): Promise<CreditWalletDocument | null> {
    try {
      let wallet = await this.creditWalletModel.findOne({ patientId }).exec();
      if (!wallet) {
        wallet = new this.creditWalletModel({
          patientId: new mongoose.Types.ObjectId(patientId),
          creditBalance: 0,
          totalCredited: 0,
          totalDebited: 0,
        });
        await wallet.save();
      }
      return wallet;
    } catch (error) {
      this.logger.error(`Error getting/creating credit wallet for patient ${patientId}`, error);
      return null;
    }
  }

  async addCredit(
    patientId: string,
    amount: number,
    reason = 'refund',
    appointmentId?: string,
    description?: string,
  ): Promise<DataResponse> {
    const dataRes: DataResponse = { code: rc.PENDING, message: '', data: null };

    try {
      const normalizedAmount = Math.max(0, Math.floor(amount || 0));
      if (normalizedAmount <= 0) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Credit amount must be greater than 0';
        return dataRes;
      }

      const wallet = await this.getOrCreateCreditWallet(patientId);
      if (!wallet) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Credit wallet not found';
        return dataRes;
      }

      wallet.creditBalance += normalizedAmount;
      wallet.totalCredited += normalizedAmount;
      await wallet.save();

      await this.recordTransaction(patientId, 'credit', normalizedAmount, reason, appointmentId, description);

      dataRes.code = rc.SUCCESS;
      dataRes.message = `Added ${normalizedAmount} credit successfully`;
      dataRes.data = wallet;
      return dataRes;
    } catch (error) {
      this.logger.error(`Error adding credit to patient ${patientId}`, error);
      dataRes.code = rc.ERROR;
      dataRes.message = 'Failed to add credit';
      return dataRes;
    }
  }

  async deductCredit(
    patientId: string,
    amount: number,
    reason = 'payment',
    appointmentId?: string,
    description?: string,
  ): Promise<DataResponse> {
    const dataRes: DataResponse = { code: rc.PENDING, message: '', data: null };

    try {
      const normalizedAmount = Math.max(0, Math.floor(amount || 0));
      if (normalizedAmount <= 0) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Credit amount must be greater than 0';
        return dataRes;
      }

      const wallet = await this.getOrCreateCreditWallet(patientId);
      if (!wallet) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Credit wallet not found';
        return dataRes;
      }

      if (wallet.creditBalance < normalizedAmount) {
        dataRes.code = rc.ERROR;
        dataRes.message = `Insufficient credit. Balance: ${wallet.creditBalance}, Required: ${normalizedAmount}`;
        return dataRes;
      }

      wallet.creditBalance -= normalizedAmount;
      wallet.totalDebited += normalizedAmount;
      await wallet.save();

      await this.recordTransaction(patientId, 'debit', normalizedAmount, reason, appointmentId, description);

      dataRes.code = rc.SUCCESS;
      dataRes.message = `Deducted ${normalizedAmount} credit successfully`;
      dataRes.data = wallet;
      return dataRes;
    } catch (error) {
      this.logger.error(`Error deducting credit from patient ${patientId}`, error);
      dataRes.code = rc.ERROR;
      dataRes.message = 'Failed to deduct credit';
      return dataRes;
    }
  }

  async getCreditBalance(patientId: string): Promise<number> {
    const wallet = await this.getOrCreateCreditWallet(patientId);
    return wallet?.creditBalance ?? 0;
  }

  async getCreditHistory(patientId: string, page = 1, limit = 20): Promise<CreditTransactionDocument[]> {
    try {
      const skip = (page - 1) * limit;
      const transactions = await this.creditTransactionModel
        .find({ patientId: new mongoose.Types.ObjectId(patientId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec();

      return transactions as CreditTransactionDocument[];
    } catch (error) {
      this.logger.error(`Error fetching credit history for patient ${patientId}`, error);
      return [];
    }
  }

  async getCreditTransactionCount(patientId: string): Promise<number> {
    try {
      return await this.creditTransactionModel.countDocuments({ patientId: new mongoose.Types.ObjectId(patientId) });
    } catch (error) {
      this.logger.error(`Error counting credit transactions for patient ${patientId}`, error);
      return 0;
    }
  }

  private async recordTransaction(
    patientId: string,
    type: 'credit' | 'debit',
    amount: number,
    reason: string,
    appointmentId?: string,
    description?: string,
  ): Promise<CreditTransactionDocument | null> {
    try {
      const transaction = new this.creditTransactionModel({
        patientId: new mongoose.Types.ObjectId(patientId),
        type,
        amount,
        reason,
        appointmentId: appointmentId ? new mongoose.Types.ObjectId(appointmentId) : undefined,
        description,
        status: 'completed',
      });

      return await transaction.save();
    } catch (error) {
      this.logger.error(`Error recording credit transaction for patient ${patientId}`, error);
      return null;
    }
  }
}
