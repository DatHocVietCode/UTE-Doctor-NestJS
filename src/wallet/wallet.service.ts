import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { WalletTransaction, WalletTransactionDocument } from './schemas/wallet-transaction.schema';
import { Wallet, WalletDocument } from './schemas/wallet.schema';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectModel(Wallet.name) private walletModel: Model<WalletDocument>,
    @InjectModel(WalletTransaction.name) private transactionModel: Model<WalletTransactionDocument>,
  ) {}

  /**
   * Get or create wallet for a patient
   */
  async getOrCreateWallet(patientId: string): Promise<WalletDocument | null> {
    try {
      console.log(`Getting or creating wallet for patient ${patientId}`);
      let wallet = await this.walletModel.findOne({ patientId }).exec();
      if (!wallet) {
        wallet = new this.walletModel({
          patientId: new mongoose.Types.ObjectId(patientId),
          coinBalance: 0,
          totalCoinEarned: 0,
          totalCoinUsed: 0,
        });
        await wallet.save();
        this.logger.log(`Created new wallet for patient ${patientId}`);
      }
      return wallet;
    } catch (error) {
      this.logger.error(`Error getting/creating wallet for patient ${patientId}`, error);
      return null;
    }
  }

  /**
   * Add coins to wallet (e.g., from refund)
   * Refund rule: 80% of consultation fee refunded as coins
   */
  async addCoins(
    patientId: string,
    amount: number,
    reason: string = 'refund',
    appointmentId?: string,
    description?: string,
  ): Promise<DataResponse> {
    const dataRes: DataResponse = {
      code: rc.PENDING,
      message: '',
      data: null,
    };

    try {
      const wallet = await this.getOrCreateWallet(patientId);
      if (!wallet) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Wallet not found';
        return dataRes;
      }

      wallet.coinBalance += amount;
      wallet.totalCoinEarned += amount;
      await wallet.save();

      // Record transaction
      await this.recordTransaction(patientId, 'earn', amount, reason, appointmentId, description);

      this.logger.log(
        `Added ${amount} coins to patient ${patientId} (reason: ${reason}). New balance: ${wallet.coinBalance}`,
      );

      dataRes.code = rc.SUCCESS;
      dataRes.message = `Added ${amount} coins successfully`;
      dataRes.data = wallet;
      return dataRes;
    } catch (error) {
      this.logger.error(`Error adding coins to patient ${patientId}`, error);
      dataRes.code = rc.ERROR;
      dataRes.message = 'Failed to add coins';
      return dataRes;
    }
  }

  /**
   * Deduct coins from wallet (e.g., for payment or discount)
   */
  async deductCoins(
    patientId: string,
    amount: number,
    reason: string = 'payment',
    appointmentId?: string,
    description?: string,
  ): Promise<DataResponse> {
    const dataRes: DataResponse = {
      code: rc.PENDING,
      message: '',
      data: null,
    };

    try {
      const wallet = await this.getOrCreateWallet(patientId);
      if (!wallet) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Wallet not found';
        return dataRes;
      }

      if (wallet.coinBalance < amount) {
        dataRes.code = rc.ERROR;
        dataRes.message = `Insufficient coins. Balance: ${wallet.coinBalance}, Required: ${amount}`;
        return dataRes;
      }

      wallet.coinBalance -= amount;
      wallet.totalCoinUsed += amount;
      await wallet.save();

      // Record transaction
      await this.recordTransaction(patientId, 'spend', amount, reason, appointmentId, description);

      this.logger.log(
        `Deducted ${amount} coins from patient ${patientId} (reason: ${reason}). New balance: ${wallet.coinBalance}`,
      );

      dataRes.code = rc.SUCCESS;
      dataRes.message = `Deducted ${amount} coins successfully`;
      dataRes.data = wallet;
      return dataRes;
    } catch (error) {
      this.logger.error(`Error deducting coins from patient ${patientId}`, error);
      dataRes.code = rc.ERROR;
      dataRes.message = 'Failed to deduct coins';
      return dataRes;
    }
  }

  /**
   * Record transaction in history
   */
  private async recordTransaction(
    patientId: string,
    type: 'earn' | 'spend',
    amount: number,
    reason: string,
    appointmentId?: string,
    description?: string,
  ): Promise<WalletTransactionDocument | null> {
    try {
      const transaction = new this.transactionModel({
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
      this.logger.error(`Error recording transaction for patient ${patientId}`, error);
      return null;
    }
  }

  /**
   * Get wallet transaction history
   */
  async getWalletHistory(
    patientId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<WalletTransactionDocument[]> {
    try {
      const skip = (page - 1) * limit;
      const transactions = await this.transactionModel
        .find({ patientId: new mongoose.Types.ObjectId(patientId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec();
      return transactions as WalletTransactionDocument[];
    } catch (error) {
      this.logger.error(`Error fetching wallet history for patient ${patientId}`, error);
      return [];
    }
  }

  /**
   * Get total count of transactions for a patient
   */
  async getWalletTransactionCount(patientId: string): Promise<number> {
    try {
      const count = await this.transactionModel.countDocuments({
        patientId: new mongoose.Types.ObjectId(patientId),
      });
      return count;
    } catch (error) {
      this.logger.error(`Error counting transactions for patient ${patientId}`, error);
      return 0;
    }
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(patientId: string): Promise<number> {
    console.log(`Fetching wallet balance for patient ${patientId}`);
    const wallet = await this.getOrCreateWallet(patientId);
    return wallet?.coinBalance ?? 0;
  }
}
