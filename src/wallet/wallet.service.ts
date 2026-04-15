import { Injectable } from '@nestjs/common';
import { DataResponse } from 'src/common/dto/data-respone';
import { CoinService } from './coin/coin.service';
import { CreditService } from './credit/credit.service';

@Injectable()
export class WalletService {
  constructor(
    private readonly coinService: CoinService,
    private readonly creditService: CreditService,
  ) {}

  // Backward-compatible facade: old callers still resolve a coin wallet through WalletService.
  async getOrCreateWallet(patientId: string) {
    return this.coinService.getOrCreateCoinWallet(patientId);
  }

  async addCoins(
    patientId: string,
    amount: number,
    reason: string = 'refund',
    appointmentId?: string,
    description?: string,
  ): Promise<DataResponse> {
    return this.coinService.addCoins(patientId, amount, reason, appointmentId, description);
  }

  async deductCoins(
    patientId: string,
    amount: number,
    reason: string = 'payment',
    appointmentId?: string,
    description?: string,
  ): Promise<DataResponse> {
    return this.coinService.spendCoins(patientId, amount, reason, appointmentId, description);
  }

  async addCredit(
    patientId: string,
    amount: number,
    reason: string = 'refund',
    appointmentId?: string,
    description?: string,
  ): Promise<DataResponse> {
    return this.creditService.addCredit(patientId, amount, reason, appointmentId, description);
  }

  async deductCredit(
    patientId: string,
    amount: number,
    reason: string = 'payment',
    appointmentId?: string,
    description?: string,
  ): Promise<DataResponse> {
    return this.creditService.deductCredit(patientId, amount, reason, appointmentId, description);
  }

  async getWalletHistory(patientId: string, page: number = 1, limit: number = 20) {
    return this.coinService.getCoinHistory(patientId, page, limit);
  }

  async getWalletTransactionCount(patientId: string): Promise<number> {
    return this.coinService.getCoinTransactionCount(patientId);
  }

  async getWalletBalance(patientId: string): Promise<number> {
    return this.coinService.getAvailableCoinBalance(patientId);
  }
}
