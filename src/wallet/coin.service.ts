import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { CoinTransaction, CoinTransactionDocument } from './schemas/coin-transaction.schema';
import { CoinWallet, CoinWalletDocument } from './schemas/coin-wallet.schema';

const DEFAULT_COIN_EXPIRE_DAYS = 180;

@Injectable()
export class CoinService {
  private readonly logger = new Logger(CoinService.name);

  constructor(
    @InjectModel(CoinWallet.name) private readonly coinWalletModel: Model<CoinWalletDocument>,
    @InjectModel(CoinTransaction.name) private readonly coinTransactionModel: Model<CoinTransactionDocument>,
  ) {}

  async getOrCreateCoinWallet(patientId: string): Promise<CoinWalletDocument | null> {
    try {
      let wallet = await this.coinWalletModel.findOne({ patientId }).exec();
      if (!wallet) {
        wallet = new this.coinWalletModel({
          patientId: new mongoose.Types.ObjectId(patientId),
          coinBalance: 0,
          totalCoinEarned: 0,
          totalCoinUsed: 0,
        });
        await wallet.save();
      }
      return wallet;
    } catch (error) {
      this.logger.error(`Error getting/creating coin wallet for patient ${patientId}`, error);
      return null;
    }
  }

  // Available balance excludes expired earn-transactions by design.
  async getAvailableCoinBalance(patientId: string): Promise<number> {
    const now = new Date();
    const patientObjectId = new mongoose.Types.ObjectId(patientId);

    const [earnedAgg, spentAgg] = await Promise.all([
      this.coinTransactionModel.aggregate<{ total: number }>([
        {
          $match: {
            patientId: patientObjectId,
            type: 'earn',
            status: 'completed',
            $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.coinTransactionModel.aggregate<{ total: number }>([
        { $match: { patientId: patientObjectId, type: 'spend', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const totalEarned = earnedAgg[0]?.total ?? 0;
    const totalSpent = spentAgg[0]?.total ?? 0;
    return Math.max(0, totalEarned - totalSpent);
  }

  async calculateDiscount(
    patientId: string,
    originalAmount: number,
    useCoin = false,
    requestedCoins?: number,
    discountRate = 0.1,
    discountCap = 30000,
  ): Promise<{ availableCoin: number; discountAmount: number; maxApplicableDiscount: number }> {
    const safeAmount = Math.max(0, Math.floor(originalAmount || 0));
    const availableCoin = await this.getAvailableCoinBalance(patientId);

    if (!useCoin || safeAmount <= 0 || availableCoin <= 0) {
      return { availableCoin, discountAmount: 0, maxApplicableDiscount: 0 };
    }

    const rateLimit = Math.floor(safeAmount * discountRate);
    const maxApplicableDiscount = Math.max(0, Math.min(safeAmount, discountCap, rateLimit));

    const requestLimit = requestedCoins && requestedCoins > 0 ? Math.floor(requestedCoins) : Number.MAX_SAFE_INTEGER;
    const discountAmount = Math.max(0, Math.min(maxApplicableDiscount, availableCoin, requestLimit));

    return {
      availableCoin,
      discountAmount,
      maxApplicableDiscount,
    };
  }

  async addCoins(
    patientId: string,
    amount: number,
    reason = 'reward',
    appointmentId?: string,
    description?: string,
    expiresAt?: Date,
  ): Promise<DataResponse> {
    const dataRes: DataResponse = { code: rc.PENDING, message: '', data: null };

    try {
      const normalizedAmount = Math.max(0, Math.floor(amount || 0));
      if (normalizedAmount <= 0) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Coin amount must be greater than 0';
        return dataRes;
      }

      const wallet = await this.getOrCreateCoinWallet(patientId);
      if (!wallet) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Coin wallet not found';
        return dataRes;
      }

      wallet.coinBalance += normalizedAmount;
      wallet.totalCoinEarned += normalizedAmount;
      await wallet.save();

      const coinExpiresAt = expiresAt ?? new Date(Date.now() + DEFAULT_COIN_EXPIRE_DAYS * 24 * 60 * 60 * 1000);
      await this.recordTransaction(patientId, 'earn', normalizedAmount, reason, appointmentId, description, coinExpiresAt);

      dataRes.code = rc.SUCCESS;
      dataRes.message = `Added ${normalizedAmount} coins successfully`;
      dataRes.data = wallet;
      return dataRes;
    } catch (error) {
      this.logger.error(`Error adding coins to patient ${patientId}`, error);
      dataRes.code = rc.ERROR;
      dataRes.message = 'Failed to add coins';
      return dataRes;
    }
  }

  async spendCoins(
    patientId: string,
    amount: number,
    reason = 'discount',
    appointmentId?: string,
    description?: string,
  ): Promise<DataResponse> {
    const dataRes: DataResponse = { code: rc.PENDING, message: '', data: null };

    try {
      const normalizedAmount = Math.max(0, Math.floor(amount || 0));
      if (normalizedAmount <= 0) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Coin amount must be greater than 0';
        return dataRes;
      }

      const wallet = await this.getOrCreateCoinWallet(patientId);
      if (!wallet) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Coin wallet not found';
        return dataRes;
      }

      const available = await this.getAvailableCoinBalance(patientId);
      if (available < normalizedAmount) {
        dataRes.code = rc.ERROR;
        dataRes.message = `Insufficient coins. Balance: ${available}, Required: ${normalizedAmount}`;
        return dataRes;
      }

      // Keep materialized balance non-negative even if old expired credits are still counted there.
      wallet.coinBalance = Math.max(0, wallet.coinBalance - normalizedAmount);
      wallet.totalCoinUsed += normalizedAmount;
      await wallet.save();

      await this.recordTransaction(patientId, 'spend', normalizedAmount, reason, appointmentId, description);

      dataRes.code = rc.SUCCESS;
      dataRes.message = `Deducted ${normalizedAmount} coins successfully`;
      dataRes.data = wallet;
      return dataRes;
    } catch (error) {
      this.logger.error(`Error spending coins from patient ${patientId}`, error);
      dataRes.code = rc.ERROR;
      dataRes.message = 'Failed to deduct coins';
      return dataRes;
    }
  }

  private async recordTransaction(
    patientId: string,
    type: 'earn' | 'spend',
    amount: number,
    reason: string,
    appointmentId?: string,
    description?: string,
    expiresAt?: Date,
  ): Promise<CoinTransactionDocument | null> {
    try {
      const transaction = new this.coinTransactionModel({
        patientId: new mongoose.Types.ObjectId(patientId),
        type,
        amount,
        reason,
        appointmentId: appointmentId ? new mongoose.Types.ObjectId(appointmentId) : undefined,
        description,
        status: 'completed',
        expiresAt: type === 'earn' ? expiresAt : undefined,
      });

      return await transaction.save();
    } catch (error) {
      this.logger.error(`Error recording coin transaction for patient ${patientId}`, error);
      return null;
    }
  }

  async getCoinHistory(patientId: string, page = 1, limit = 20): Promise<CoinTransactionDocument[]> {
    try {
      const skip = (page - 1) * limit;
      const transactions = await this.coinTransactionModel
        .find({ patientId: new mongoose.Types.ObjectId(patientId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec();

      return transactions as CoinTransactionDocument[];
    } catch (error) {
      this.logger.error(`Error fetching coin history for patient ${patientId}`, error);
      return [];
    }
  }

  async getCoinTransactionCount(patientId: string): Promise<number> {
    try {
      return await this.coinTransactionModel.countDocuments({ patientId: new mongoose.Types.ObjectId(patientId) });
    } catch (error) {
      this.logger.error(`Error counting coin transactions for patient ${patientId}`, error);
      return 0;
    }
  }
}
