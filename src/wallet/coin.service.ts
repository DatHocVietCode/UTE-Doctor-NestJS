import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { COIN_EXPIRY_DAYS, COIN_REWARD_RATE } from './coin-reward.config';
import { CoinTransaction, CoinTransactionDocument } from './schemas/coin-transaction.schema';
import { CoinWallet, CoinWalletDocument } from './schemas/coin-wallet.schema';

const DEFAULT_COIN_EXPIRE_DAYS = 180;
const EXPIRING_SOON_DAYS = 7;

type CoinSummaryBreakdownItem = {
  transactionId: string;
  amount: number;
  used: number;
  remaining: number;
  expiresAt: Date | null;
  category: 'active' | 'expired' | 'non_expiring';
  isExpiringSoon: boolean;
};

type CoinSummaryResult = {
  totalBalance: number;
  usableCoin: number;
  expiredCoin: number;
  expiringSoon: number;
  breakdown: CoinSummaryBreakdownItem[];
};

type CoinSummaryLeanTx = {
  _id: mongoose.Types.ObjectId;
  type: 'earn' | 'spend';
  amount: number;
  expiresAt?: Date;
  createdAt?: Date;
};

type CoinConsumptionAllocation = {
  transactionId: string;
  amount: number;
  consumed: number;
  remaining: number;
  expiresAt: Date | null;
  category: 'active' | 'non_expiring';
  isExpiringSoon: boolean;
};

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

      const transactions = await this.loadCompletedCoinTransactions(patientId);
      const earnTransactions = transactions.filter((tx) => tx.type === 'earn');
      const { allocation, remainingSpend } = this.buildFefoSpendPlan(earnTransactions, normalizedAmount, new Date());

      if (remainingSpend > 0) {
        // This should not happen after the balance check; keep it as a guard for inconsistent history.
        this.logger.warn(
          `Unable to fully allocate coin spend for patient ${patientId}. Remaining unallocated amount: ${remainingSpend}`,
        );
        dataRes.code = rc.ERROR;
        dataRes.message = 'Failed to allocate coin spend';
        return dataRes;
      }

      // Materialized balance stays as a quick-read cache; FEFO allocation is enforced by transaction history.
      wallet.coinBalance = Math.max(0, wallet.coinBalance - normalizedAmount);
      wallet.totalCoinUsed += normalizedAmount;
      await wallet.save();

      this.logger.log(
        `Spent ${normalizedAmount} coin for patient ${patientId} using FEFO lots: ${allocation
          .map((item) => `${item.transactionId}:${item.consumed}`)
          .join(', ')}`,
      );

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

  private normalizeCoinAmount(amount: number): number {
    return Math.max(0, Math.floor(amount || 0));
  }

  private compareByExpiryThenCreatedAt(
    left: { expiresAt?: Date; createdAt?: Date; _id: mongoose.Types.ObjectId },
    right: { expiresAt?: Date; createdAt?: Date; _id: mongoose.Types.ObjectId },
  ): number {
    const leftExpiry = left.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightExpiry = right.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;

    if (leftExpiry !== rightExpiry) {
      return leftExpiry - rightExpiry;
    }

    const leftCreatedAt = left.createdAt?.getTime() ?? 0;
    const rightCreatedAt = right.createdAt?.getTime() ?? 0;

    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }

    return left._id.toString().localeCompare(right._id.toString());
  }

  private compareByCreatedAt(
    left: { createdAt?: Date; _id: mongoose.Types.ObjectId },
    right: { createdAt?: Date; _id: mongoose.Types.ObjectId },
  ): number {
    const leftCreatedAt = left.createdAt?.getTime() ?? 0;
    const rightCreatedAt = right.createdAt?.getTime() ?? 0;

    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }

    return left._id.toString().localeCompare(right._id.toString());
  }

  private async loadCompletedCoinTransactions(patientId: string): Promise<CoinSummaryLeanTx[]> {
    return this.coinTransactionModel
      .find({
        patientId: new mongoose.Types.ObjectId(patientId),
        status: 'completed',
      })
      .select('_id type amount expiresAt createdAt')
      .lean<CoinSummaryLeanTx[]>()
      .exec();
  }

  private getExpiredEarns(transactions: CoinSummaryLeanTx[], now: Date): CoinSummaryLeanTx[] {
    const expired = transactions
      .filter((tx) => tx.type === 'earn' && tx.expiresAt && tx.expiresAt <= now)
      .sort((left, right) => this.compareByExpiryThenCreatedAt(left, right));

    if (expired.length > 0) {
      this.logger.debug(`[GetExpiredEarns] expiredEarns=${expired.length}`);
    }

    return expired;
  }

  private getSpendableEarns(transactions: CoinSummaryLeanTx[], now: Date): CoinSummaryLeanTx[] {
    const activeEarns = transactions
      .filter((tx) => tx.type === 'earn' && tx.expiresAt && tx.expiresAt > now)
      .sort((left, right) => this.compareByExpiryThenCreatedAt(left, right));

    const nonExpiringEarns = transactions
      .filter((tx) => tx.type === 'earn' && !tx.expiresAt)
      .sort((left, right) => this.compareByCreatedAt(left, right));

    this.logger.debug(
      `[GetSpendableEarns] activeEarns=${activeEarns.length}, nonExpiringEarns=${nonExpiringEarns.length}`,
    );

    // FEFO means the closest expiry is consumed first; non-expiring lots are the fallback bucket.
    return [...activeEarns, ...nonExpiringEarns];
  }

  private buildFefoSpendPlan(
    earnTransactions: CoinSummaryLeanTx[],
    spendAmount: number,
    now: Date,
  ): { allocation: CoinConsumptionAllocation[]; remainingSpend: number } {
    let remainingSpend = this.normalizeCoinAmount(spendAmount);
    const allocation: CoinConsumptionAllocation[] = [];
    const expiringSoonThreshold = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);

    const spendableEarns = this.getSpendableEarns(earnTransactions, now);
    this.logger.debug(
      `[BuildFefoSpendPlan] spendAmount=${spendAmount}, spendableEarns=${spendableEarns.length}, earnTotal=${earnTransactions.length}`,
    );

    for (const earn of spendableEarns) {
      if (remainingSpend <= 0) {
        break;
      }

      const amount = this.normalizeCoinAmount(earn.amount);
      if (amount <= 0) {
        continue;
      }

      const consumed = Math.min(amount, remainingSpend);
      remainingSpend -= consumed;

      allocation.push({
        transactionId: earn._id.toString(),
        amount,
        consumed,
        remaining: Math.max(0, amount - consumed),
        expiresAt: earn.expiresAt ?? null,
        category: earn.expiresAt ? 'active' : 'non_expiring',
        isExpiringSoon: Boolean(earn.expiresAt && earn.expiresAt <= expiringSoonThreshold),
      });
    }

    this.logger.debug(
      `[BuildFefoSpendPlan] result: allocation=${allocation.length}, remainingSpend=${remainingSpend}`,
    );

    return { allocation, remainingSpend };
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

  async getCoinSummary(patientId: string): Promise<CoinSummaryResult> {
    const now = new Date();

    try {
      const transactions = await this.loadCompletedCoinTransactions(patientId);

      const earns = transactions.filter((tx) => tx.type === 'earn');
      const spends = transactions.filter((tx) => tx.type === 'spend');
      
      if (earns.length > 0) {
        this.logger.debug(
          `[CoinSummary] Patient ${patientId}: Total earns=${earns.length}, details=${earns
            .map((e) => `{id:${e._id}, amt:${e.amount}, exp:${e.expiresAt}, created:${e.createdAt}}`)
            .join('; ')}`,
        );
      }
      
      if (spends.length > 0) {
        this.logger.debug(
          `[CoinSummary] Patient ${patientId}: Total spends=${spends.length}, details=${spends
            .map((s) => `{id:${s._id}, amt:${s.amount}}`)
            .join('; ')}`,
        );
      }
      
      const totalSpent = spends.reduce((sum, tx) => sum + Math.max(0, Math.floor(tx.amount || 0)), 0);
      this.logger.debug(`[CoinSummary] Patient ${patientId}: totalSpent=${totalSpent}`);

      const expiredEarns = this.getExpiredEarns(earns, now);
      const spendableEarns = this.getSpendableEarns(earns, now);
      const spendPlan = this.buildFefoSpendPlan(earns, totalSpent, now);

      const breakdown: CoinSummaryBreakdownItem[] = [];
      const expiredCoin = expiredEarns.reduce((sum, earn) => sum + Math.max(0, Math.floor(earn.amount || 0)), 0);
      const expiringSoonThreshold = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);

      // Add expired earns to breakdown.
      for (const earn of expiredEarns) {
        const amount = Math.max(0, Math.floor(earn.amount || 0));
        breakdown.push({
          transactionId: earn._id.toString(),
          amount,
          used: 0,
          remaining: amount,
          expiresAt: earn.expiresAt ?? null,
          category: 'expired',
          isExpiringSoon: false,
        });
      }

      // Track which earns were already allocated by FEFO spend plan.
      const allocatedTransactionIds = new Set(spendPlan.allocation.map((a) => a.transactionId));

      let usableCoin = 0;
      let expiringSoon = 0;

      // Add allocated (touched by spend) spendable earns to breakdown.
      for (const item of spendPlan.allocation) {
        const isActive = item.category === 'active';
        if (isActive && item.isExpiringSoon) {
          expiringSoon += item.remaining;
        }
        usableCoin += item.remaining;

        breakdown.push({
          transactionId: item.transactionId,
          amount: item.amount,
          used: item.consumed,
          remaining: item.remaining,
          expiresAt: item.expiresAt,
          category: item.category,
          isExpiringSoon: item.isExpiringSoon,
        });
      }

      // Add unallocated (untouched by spend) spendable earns to breakdown.
      for (const earn of spendableEarns) {
        if (allocatedTransactionIds.has(earn._id.toString())) {
          continue; // Already added above.
        }

        const amount = Math.max(0, Math.floor(earn.amount || 0));
        const isExpiringSoon = earn.expiresAt && earn.expiresAt <= expiringSoonThreshold;

        usableCoin += amount;
        if (isExpiringSoon) {
          expiringSoon += amount;
        }

        breakdown.push({
          transactionId: earn._id.toString(),
          amount,
          used: 0,
          remaining: amount,
          expiresAt: earn.expiresAt ?? null,
          category: earn.expiresAt ? 'active' : 'non_expiring',
          isExpiringSoon: Boolean(isExpiringSoon),
        });
      }

      this.logger.debug(
        `[CoinSummary] Final breakdown for patient ${patientId}: total=${breakdown.length}, usable=${usableCoin}, expired=${expiredCoin}, expiringSoon=${expiringSoon}`,
      );

      return {
        totalBalance: Math.max(0, usableCoin + expiredCoin),
        usableCoin: Math.max(0, usableCoin),
        expiredCoin: Math.max(0, expiredCoin),
        expiringSoon: Math.max(0, expiringSoon),
        breakdown,
      };
    } catch (error) {
      this.logger.error(`Error building coin summary for patient ${patientId}`, error);
      return {
        totalBalance: 0,
        usableCoin: 0,
        expiredCoin: 0,
        expiringSoon: 0,
        breakdown: [],
      };
    }
  }

  async rewardCoinForCompletedAppointment(
    patientId: string,
    appointmentId: string,
    consultationFee: number,
  ): Promise<{ rewarded: boolean; amount: number; message: string }> {
    const normalizedFee = Math.max(0, Math.floor(consultationFee || 0));
    const rewardAmount = Math.max(0, Math.floor(normalizedFee * COIN_REWARD_RATE));

    if (rewardAmount <= 0) {
      return {
        rewarded: false,
        amount: 0,
        message: 'Skip reward because calculated coin is 0',
      };
    }

    const patientObjectId = new mongoose.Types.ObjectId(patientId);
    const appointmentObjectId = new mongoose.Types.ObjectId(appointmentId);
    const expiresAt = new Date(Date.now() + COIN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const existing = await this.coinTransactionModel.findOne({
      appointmentId: appointmentObjectId,
      type: 'earn',
      reason: 'appointment_completed_reward',
      status: 'completed',
    }).select('_id').lean();

    if (existing) {
      this.logger.log(`Skip duplicate coin reward for appointment ${appointmentId}`);
      return {
        rewarded: false,
        amount: 0,
        message: 'Reward already exists for this appointment',
      };
    }

    const session = await this.coinWalletModel.db.startSession();
    try {
      await session.withTransaction(async () => {
        const duplicateInTxn = await this.coinTransactionModel.findOne({
          appointmentId: appointmentObjectId,
          type: 'earn',
          reason: 'appointment_completed_reward',
          status: 'completed',
        }).session(session).select('_id');

        if (duplicateInTxn) {
          return;
        }

        await this.coinWalletModel.updateOne(
          { patientId: patientObjectId },
          {
            $setOnInsert: {
              patientId: patientObjectId,
            },
            $inc: {
              coinBalance: rewardAmount,
              totalCoinEarned: rewardAmount,
            },
          },
          {
            upsert: true,
            session,
          },
        );

        await this.coinTransactionModel.create([
          {
            patientId: patientObjectId,
            appointmentId: appointmentObjectId,
            type: 'earn',
            amount: rewardAmount,
            reason: 'appointment_completed_reward',
            description: `Reward ${rewardAmount} coin after appointment completion`,
            expiresAt,
            status: 'completed',
          },
        ], { session });
      });

      this.logger.log(
        `Rewarded ${rewardAmount} coin for patient ${patientId} from completed appointment ${appointmentId}`,
      );

      return {
        rewarded: true,
        amount: rewardAmount,
        message: `Rewarded ${rewardAmount} coin successfully`,
      };
    } catch (error: any) {
      // Duplicate-key from unique index means idempotent reward already created.
      if (error?.code === 11000) {
        this.logger.log(`Skip duplicate coin reward for appointment ${appointmentId} (unique index)`);
        return {
          rewarded: false,
          amount: 0,
          message: 'Reward already exists for this appointment',
        };
      }

      this.logger.error(`Failed to reward coin for appointment ${appointmentId}`, error);
      return {
        rewarded: false,
        amount: 0,
        message: 'Failed to create completion reward',
      };
    } finally {
      await session.endSession();
    }
  }
}
