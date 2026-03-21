import type { PublicKey } from '@solana/web3.js';
import type { IssuePolicyParams, IssuePolicyResult, KestrelClient } from './KestrelClient';

export interface UnderwriterIssueOptions {
  mode?: 'bypass' | 'normal';
}

export type UnderwriterIssueResult =
  | ({ issued: true } & IssuePolicyResult)
  | { issued: false; message: string };

export class KestrelUnderwriter {
  constructor(private readonly client: KestrelClient) {}

  async issuePolicy(
    params: IssuePolicyParams,
    _options: UnderwriterIssueOptions = {},
  ): Promise<UnderwriterIssueResult> {
    try {
      const result = await this.client.issuePolicy(params);
      return { issued: true, ...result };
    } catch (error: unknown) {
      return {
        issued: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function policyAddressForBuyer(client: KestrelClient, buyer: PublicKey): PublicKey {
  return client.findPolicyPdaForTest(buyer);
}
