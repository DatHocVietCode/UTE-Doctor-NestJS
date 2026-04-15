import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { ClientSession, Model } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { COIN_EXPIRY_DAYS, COIN_REWARD_RATE } from './coin-reward.config';
import {
  CoinSummaryBreakdownItemDto,
  CoinSummaryResponseDto,
} from './dto/coin-summary-response.dto';
import {
  CoinSpendAllocation,
  CoinSpendAllocationDocument,
} from './schemas/coin-spend-allocation.schema';
import { CoinTransaction, CoinTransactionDocument } from './schemas/coin-transaction.schema';
import { CoinWallet, CoinWalletDocument } from './schemas/coin-wallet.schema';

const DEFAULT_COIN_EXPIRE_DAYS = 180;
const EXPIRING_SOON_DAYS = 7;
const ERR_INSUFFICIENT_ALLOCATABLE_COIN = 'INSUFFICIENT_ALLOCATABLE_COIN';

type EarnTransactionLean = {
  _id: mongoose.Types.ObjectId;
  amount: number;
  expiresAt?: Date;
  createdAt?: Date;
};

type EarnUsageProjection = {
  earn: EarnTransactionLean;
  used: number;
  remaining: number;
};

@Injectable()
export class CoinService {
  private readonly logger = new Logger(CoinService.name);

  constructor(
    @InjectModel(CoinWallet.name) private readonly coinWalletModel: Model<CoinWalletDocument>,
    @InjectModel(CoinTransaction.name) private readonly coinTransactionModel: Model<CoinTransactionDocument>,
    @InjectModel(CoinSpendAllocation.name)
    private readonly coinSpendAllocationModel: Model<CoinSpendAllocationDocument>,
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

  // Available balance is computed from earn lots minus immutable allocation rows, excluding expired lots.
  async getAvailableCoinBalance(patientId: string): Promise<number> {
    const now = new Date();
    // Guard against clock-skewed/future-created earns being counted in present-time balance.
    const earnTransactions = await this.loadCompletedEarnTransactions(patientId, {
      upToCreatedAt: now,
      onlyUnexpiredAt: now,
    });

    if (earnTransactions.length === 0) {
      return 0;
    }

    const allocationMap = await this.loadAllocationMapForEarns(patientId, earnTransactions.map((tx) => tx._id));
    const usableCoin = earnTransactions.reduce((sum, earn) => {
      const amount = this.normalizeCoinAmount(earn.amount);
      const used = Math.min(amount, allocationMap.get(earn._id.toString()) ?? 0);
      const remaining = Math.max(0, amount - used);
      return sum + remaining;
    }, 0);

    return Math.max(0, usableCoin);
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
      const normalizedAmount = this.normalizeCoinAmount(amount);
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

    const normalizedAmount = this.normalizeCoinAmount(amount);
    if (normalizedAmount <= 0) {
      dataRes.code = rc.ERROR;
      dataRes.message = 'Coin amount must be greater than 0';
      return dataRes;
    }

    const patientObjectId = new mongoose.Types.ObjectId(patientId);
    const spendCreatedAt = new Date();
    const session = await this.coinWalletModel.db.startSession();

    try {
      let persistedWallet: CoinWalletDocument | null = null;

      await session.withTransaction(async () => {
        let wallet = await this.coinWalletModel.findOne({ patientId: patientObjectId }).session(session);
        if (!wallet) {
          wallet = new this.coinWalletModel({
            patientId: patientObjectId,
            coinBalance: 0,
            totalCoinEarned: 0,
            totalCoinUsed: 0,
          });
        }

        const eligibleEarns = await this.loadCompletedEarnTransactions(
          patientId,
          {
            upToCreatedAt: spendCreatedAt,
            onlyUnexpiredAt: spendCreatedAt,
          },
          session,
        );

        const allocationMap = await this.loadAllocationMapForEarns(
          patientId,
          eligibleEarns.map((tx) => tx._id),
          session,
        );

        // FEFO selection is fixed at spend-write time and persisted via allocation rows.
        const sortedEligibleEarns = this.sortSpendableEarnTransactions(eligibleEarns, spendCreatedAt);
        const allocationRows: Array<{
          earnTransactionId: mongoose.Types.ObjectId;
          amount: number;
        }> = [];

        let remainingSpend = normalizedAmount;
        for (const earn of sortedEligibleEarns) {
          if (remainingSpend <= 0) {
            break;
          }

          const earnAmount = this.normalizeCoinAmount(earn.amount);
          const usedAmount = Math.min(earnAmount, allocationMap.get(earn._id.toString()) ?? 0);
          const availableAmount = Math.max(0, earnAmount - usedAmount);
          if (availableAmount <= 0) {
            continue;
          }

          const consumeAmount = Math.min(availableAmount, remainingSpend);
          allocationRows.push({
            earnTransactionId: earn._id,
            amount: consumeAmount,
          });
          remainingSpend -= consumeAmount;
        }

        if (remainingSpend > 0) {
          throw new Error(ERR_INSUFFICIENT_ALLOCATABLE_COIN);
        }

        const spendTransaction = await this.recordTransaction(
          patientId,
          'spend',
          normalizedAmount,
          reason,
          appointmentId,
          description,
          undefined,
          session,
          spendCreatedAt,
        );

        if (!spendTransaction) {
          throw new Error('FAILED_TO_CREATE_SPEND_TRANSACTION');
        }

        if (allocationRows.length > 0) {
          // Mongoose requires ordered inserts when a session writes multiple allocation rows in one call.
          await this.coinSpendAllocationModel.create(
            allocationRows.map((row) => ({
              spendTransactionId: spendTransaction._id,
              earnTransactionId: row.earnTransactionId,
              patientId: patientObjectId,
              amount: row.amount,
            })),
            { session, ordered: true },
          );
        }

        wallet.coinBalance = Math.max(0, wallet.coinBalance - normalizedAmount);
        wallet.totalCoinUsed += normalizedAmount;
        persistedWallet = await wallet.save({ session });

        this.logger.debug(
          `[CoinAllocation] spendTx=${spendTransaction._id.toString()} allocations=${allocationRows.length} requested=${normalizedAmount}`,
        );
      });

      dataRes.code = rc.SUCCESS;
      dataRes.message = `Deducted ${normalizedAmount} coins successfully`;
      dataRes.data = persistedWallet;
      return dataRes;
    } catch (error: any) {
      if (error?.message === ERR_INSUFFICIENT_ALLOCATABLE_COIN) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Insufficient coins';
        return dataRes;
      }

      this.logger.error(`Error spending coins from patient ${patientId}`, error);
      dataRes.code = rc.ERROR;
      dataRes.message = 'Failed to deduct coins';
      return dataRes;
    } finally {
      await session.endSession();
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

  private sortSpendableEarnTransactions(earns: EarnTransactionLean[], now: Date): EarnTransactionLean[] {
    const activeEarns = earns
      .filter((tx) => tx.expiresAt && tx.expiresAt > now)
      .sort((left, right) => this.compareByExpiryThenCreatedAt(left, right));

    const nonExpiringEarns = earns
      .filter((tx) => !tx.expiresAt)
      .sort((left, right) => this.compareByCreatedAt(left, right));

    return [...activeEarns, ...nonExpiringEarns];
  }

  private async loadCompletedEarnTransactions(
    patientId: string,
    options?: {
      upToCreatedAt?: Date;
      onlyUnexpiredAt?: Date;
    },
    session?: ClientSession,
  ): Promise<EarnTransactionLean[]> {
    const query: any = {
      patientId: new mongoose.Types.ObjectId(patientId),
      status: 'completed',
      type: 'earn',
    };

    if (options?.upToCreatedAt) {
      query.createdAt = { $lte: options.upToCreatedAt };
    }

    if (options?.onlyUnexpiredAt) {
      const expiresAtFilter = {
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gt: options.onlyUnexpiredAt } },
        ],
      };

      if (query.$and) {
        query.$and.push(expiresAtFilter);
      } else {
        query.$and = [expiresAtFilter];
      }
    }

    const mongoQuery = this.coinTransactionModel
      .find(query)
      .select('_id amount expiresAt createdAt')
      .lean<EarnTransactionLean[]>();

    if (session) {
      mongoQuery.session(session);
    }

    return mongoQuery.exec();
  }

  private async loadAllocationMapForEarns(
    patientId: string,
    earnIds: mongoose.Types.ObjectId[],
    session?: ClientSession,
  ): Promise<Map<string, number>> {
    const allocationMap = new Map<string, number>();
    if (earnIds.length === 0) {
      return allocationMap;
    }

    const aggregate = this.coinSpendAllocationModel.aggregate<{ _id: mongoose.Types.ObjectId; totalAllocated: number }>([
      {
        $match: {
          patientId: new mongoose.Types.ObjectId(patientId),
          earnTransactionId: { $in: earnIds },
        },
      },
      {
        $group: {
          _id: '$earnTransactionId',
          totalAllocated: { $sum: '$amount' },
        },
      },
    ]);

    if (session) {
      aggregate.session(session);
    }

    const rows = await aggregate.exec();
    for (const row of rows) {
      allocationMap.set(row._id.toString(), this.normalizeCoinAmount(row.totalAllocated));
    }

    return allocationMap;
  }

  private async recordTransaction(
    patientId: string,
    type: 'earn' | 'spend',
    amount: number,
    reason: string,
    appointmentId?: string,
    description?: string,
    expiresAt?: Date,
    session?: ClientSession,
    createdAt?: Date,
  ): Promise<CoinTransactionDocument | null> {
    try {
      const payload: any = {
        patientId: new mongoose.Types.ObjectId(patientId),
        type,
        amount,
        reason,
        appointmentId: appointmentId ? new mongoose.Types.ObjectId(appointmentId) : undefined,
        description,
        status: 'completed',
        expiresAt: type === 'earn' ? expiresAt : undefined,
      };

      if (createdAt) {
        payload.createdAt = createdAt;
        payload.updatedAt = createdAt;
      }

      const transaction = new this.coinTransactionModel(payload);
      return transaction.save(session ? { session } : undefined);
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
      return this.coinTransactionModel.countDocuments({ patientId: new mongoose.Types.ObjectId(patientId) });
    } catch (error) {
      this.logger.error(`Error counting coin transactions for patient ${patientId}`, error);
      return 0;
    }
  }

  async getCoinSummary(patientId: string): Promise<CoinSummaryResponseDto> {
    const now = new Date();
    const expiringSoonThreshold = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);

    try {
      // Summary must represent "as-of now" lots only; future-created earns are excluded.
      const earns = await this.loadCompletedEarnTransactions(patientId, {
        upToCreatedAt: now,
      });
      if (earns.length === 0) {
        return {
          totalBalance: 0,
          usableCoin: 0,
          expiredCoin: 0,
          expiringSoon: 0,
          breakdown: [],
        };
      }

      const allocationMap = await this.loadAllocationMapForEarns(
        patientId,
        earns.map((tx) => tx._id),
      );

      const expiredEarns = earns
        .filter((tx) => tx.expiresAt && tx.expiresAt <= now)
        .sort((left, right) => this.compareByExpiryThenCreatedAt(left, right));

      const activeEarns = earns
        .filter((tx) => tx.expiresAt && tx.expiresAt > now)
        .sort((left, right) => this.compareByExpiryThenCreatedAt(left, right));

      const nonExpiringEarns = earns
        .filter((tx) => !tx.expiresAt)
        .sort((left, right) => this.compareByCreatedAt(left, right));

      const orderedEarns = [...expiredEarns, ...activeEarns, ...nonExpiringEarns];

      const breakdown: CoinSummaryBreakdownItemDto[] = [];
      let usableCoin = 0;
      let expiredCoin = 0;
      let expiringSoon = 0;

      for (const earn of orderedEarns) {
        const amount = this.normalizeCoinAmount(earn.amount);
        const used = Math.min(amount, allocationMap.get(earn._id.toString()) ?? 0);
        const remaining = Math.max(0, amount - used);

        const hasExpiry = Boolean(earn.expiresAt);
        const isExpired = Boolean(hasExpiry && earn.expiresAt && earn.expiresAt <= now);
        const isExpiringSoon = Boolean(
          hasExpiry && earn.expiresAt && earn.expiresAt > now && earn.expiresAt <= expiringSoonThreshold,
        );

        const category: CoinSummaryBreakdownItemDto['category'] = !hasExpiry
          ? 'non_expiring'
          : isExpired
            ? 'expired'
            : 'active';

        if (category === 'expired') {
          expiredCoin += remaining;
        } else {
          usableCoin += remaining;
        }

        if (category === 'active' && isExpiringSoon) {
          expiringSoon += remaining;
        }

        // Expose epoch milliseconds in API contract to keep FE rendering timezone-safe and deterministic.
        breakdown.push({
          transactionId: earn._id.toString(),
          amount,
          used,
          remaining,
          createdAt: earn.createdAt ? earn.createdAt.getTime() : null,
          expiresAt: earn.expiresAt ? earn.expiresAt.getTime() : null,
          category,
          isExpiringSoon,
        });
      }

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
    const normalizedFee = this.normalizeCoinAmount(consultationFee);
    const rewardAmount = this.normalizeCoinAmount(normalizedFee * COIN_REWARD_RATE);

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

    const existing = await this.coinTransactionModel
      .findOne({
        appointmentId: appointmentObjectId,
        type: 'earn',
        reason: 'appointment_completed_reward',
        status: 'completed',
      })
      .select('_id')
      .lean();

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
        const duplicateInTxn = await this.coinTransactionModel
          .findOne({
            appointmentId: appointmentObjectId,
            type: 'earn',
            reason: 'appointment_completed_reward',
            status: 'completed',
          })
          .session(session)
          .select('_id');

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

        await this.coinTransactionModel.create(
          [
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
          ],
          { session },
        );
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
