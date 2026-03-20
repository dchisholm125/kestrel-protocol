import { createProtectionQuote, prepareProtection, previewSettlement } from './math.js';
import type {
  KestrelMarketState,
  KestrelPrepareProtectionInput,
  KestrelPrepareProtectionResult,
  ProtectionQuote,
  ProtectionQuoteRequest,
  SettlementPreview,
  SettlementPreviewInput,
} from './types.js';

export interface KestrelSdkOptions {
  marketProvider?: () => Promise<KestrelMarketState>;
}

export class KestrelSdk {
  private readonly marketProvider?: () => Promise<KestrelMarketState>;

  constructor(options: KestrelSdkOptions = {}) {
    this.marketProvider = options.marketProvider;
  }

  async getMarket(): Promise<KestrelMarketState> {
    if (!this.marketProvider) {
      throw new Error('No marketProvider configured for KestrelSdk');
    }
    return this.marketProvider();
  }

  quote(input: ProtectionQuoteRequest): ProtectionQuote {
    return createProtectionQuote(input);
  }

  prepare(input: KestrelPrepareProtectionInput): KestrelPrepareProtectionResult {
    return prepareProtection(input);
  }

  previewSettlement(input: SettlementPreviewInput): SettlementPreview {
    return previewSettlement(input);
  }
}
