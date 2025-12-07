import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { Wallet, WalletDocument } from './schemas/wallet.schema';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectModel(Wallet.name) private walletModel: Model<WalletDocument>,
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
  async addCoins(patientId: string, amount: number, reason: string = 'refund'): Promise<DataResponse> {
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
  async deductCoins(patientId: string, amount: number, reason: string = 'payment'): Promise<DataResponse> {
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
   * Get wallet balance
   */
  async getWalletBalance(patientId: string): Promise<number> {
    console.log(`Fetching wallet balance for patient ${patientId}`);
    const wallet = await this.getOrCreateWallet(patientId);
    return wallet?.coinBalance ?? 0;
  }
}
