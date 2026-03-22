<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useWallet } from '@solana/wallet-adapter-vue';
import { KestrelSDK, type GuaranteeOption, type MarketState } from '@kestrel-protocol/sdk';

const { connected } = useWallet();

// Token pair constants
const SUPPORTED_TOKEN_PAIR_FROM = 'SOL';
const SUPPORTED_TOKEN_PAIR_TO = 'USDC';

const basePrice = 145.2;
const payAmount = ref<number>(1);
const isProtected = ref<boolean>(true);
const market = ref<MarketState | null>(null);
const selectedGuaranteedBps = ref<number | null>(null);
const marketLoading = ref<boolean>(true);
const showHowItWorks = ref<boolean>(false);

const receiveAmount = computed(() => {
  return (payAmount.value * basePrice).toFixed(2);
});

const swapSizeUsd = computed(() => payAmount.value * basePrice);

const isSupportedTokenPair = computed(() => {
  // Currently only SOL/USDC is supported
  return true; // Hardcoded for SOL/USDC
});

const isTokenPairValid = computed(() => {
  return isSupportedTokenPair.value;
});

const selectedTier = computed<GuaranteeOption | null>(() => {
  if (!market.value?.guaranteeOptions.length || selectedGuaranteedBps.value === null) {
    return null;
  }

  return market.value.guaranteeOptions.find((tier) => tier.guaranteedBps === selectedGuaranteedBps.value) ?? null;
});

const premiumBps = computed(() => selectedTier.value?.premiumBps ?? 0);
const premiumUsd = computed(() => swapSizeUsd.value * (premiumBps.value / 10000));
const formattedPremiumUsd = computed(() => `~$${premiumUsd.value.toFixed(3)}`);

const regimeDot = computed(() => {
  if (market.value?.regime === 'HALTED') return '🔴';
  if (market.value?.regime === 'ELEVATED') return '🟡';
  return '🟢';
});

const isHalted = computed(() => market.value?.regime === 'HALTED');

const isKestrelDisabled = computed(() => {
  return isHalted.value || marketLoading.value || !isTokenPairValid.value;
});

const tierOptions = computed(() => {
  if (!market.value?.guaranteeOptions.length) {
    return [];
  }

  return market.value.guaranteeOptions.map((tier) => {
    const usd = swapSizeUsd.value * (tier.premiumBps / 10000);
    return {
      ...tier,
      premiumUsdLabel: `~$${usd.toFixed(3)}`,
    };
  });
});

onMounted(async () => {
  try {
    const sdk = new KestrelSDK({ network: 'mainnet-beta' });
    const liveMarket = await sdk.getMarket();
    market.value = liveMarket;
    selectedGuaranteedBps.value = liveMarket.guaranteeOptions[0]?.guaranteedBps ?? null;

    if (liveMarket.regime === 'HALTED') {
      isProtected.value = false;
    }
  } finally {
    marketLoading.value = false;
  }
});

const handleSwap = () => {
  if (!connected.value) {
    alert("Please connect your wallet first!");
    return;
  }
  console.log("Executing swap...", { isProtected: isProtected.value });
};
</script>

<template>
  <div class="card border-0 shadow-sm">
    <div class="card-body p-4">
      <h5 class="card-title mb-4 fw-bold">Swap</h5>
      
      <!-- Pay Section -->
      <div class="bg-light p-3 rounded mb-2">
        <label class="small text-muted mb-1">You Pay</label>
        <div class="d-flex align-items-center">
          <input type="number" v-model="payAmount" class="form-control form-control-lg border-0 bg-transparent p-0 shadow-none fw-bold" />
          <span class="badge bg-white text-dark border ms-2 p-2">SOL</span>
        </div>
      </div>

      <!-- Receive Section -->
      <div class="bg-light p-3 rounded mb-4">
        <label class="small text-muted mb-1">You Receive (Est.)</label>
        <div class="d-flex align-items-center">
          <div class="form-control form-control-lg border-0 bg-transparent p-0 shadow-none fw-bold">{{ receiveAmount }}</div>
          <span class="badge bg-white text-dark border ms-2 p-2">USDC</span>
        </div>
      </div>

      <!-- Kestrel Protection Toggle -->
      <div class="card border-primary bg-primary bg-opacity-10 mb-4">
        <div class="card-body py-2 px-3">
          <div class="small mb-2 fw-semibold text-primary-emphasis">
            <template v-if="marketLoading">Loading market…</template>
            <template v-else-if="market">
              {{ regimeDot }} {{ market.regime }}
              <span v-if="market.regime !== 'HALTED'"> | {{ (market.breachRate * 100).toFixed(1) }}% breach rate</span>
            </template>
          </div>

          <div class="form-check form-switch d-flex justify-content-between align-items-center p-0">
            <label class="form-check-label fw-bold text-primary" for="kestrelToggle" :title="!isTokenPairValid ? 'Kestrel v1 supports SOL/USDC only' : ''">
              Protect Execution with Kestrel
              <img
                src="../assets/kestrel-protocol.png"
                alt="Kestrel"
                class="kestrel-inline-logo"
              />
            </label>
            <input class="form-check-input ms-0" type="checkbox" id="kestrelToggle" v-model="isProtected" :disabled="isKestrelDisabled">
          </div>

          <div v-if="isProtected && market" class="mt-2 border-top border-primary border-opacity-25 pt-2">
            <div class="d-flex flex-wrap gap-2 align-items-center small mb-2">
              <span class="text-muted">Coverage:</span>
              <select v-model.number="selectedGuaranteedBps" class="form-select form-select-sm kestrel-select">
                <option
                  v-for="tier in tierOptions"
                  :key="tier.guaranteedBps"
                  :value="tier.guaranteedBps"
                >
                  ±{{ tier.guaranteedBps }} bps — {{ tier.premiumBps }} bps ({{ tier.premiumUsdLabel }})
                </option>
              </select>
              <span class="text-muted">Premium:</span>
              <span class="fw-bold text-primary">{{ premiumBps }} bps ({{ formattedPremiumUsd }})</span>
            </div>

            <p class="small text-muted mb-2">
              If slippage exceeds ±{{ selectedTier?.guaranteedBps ?? 0 }} bps, Kestrel pays the difference automatically.
            </p>

            <button class="btn btn-link btn-sm p-0 kestrel-link" type="button" @click="showHowItWorks = !showHowItWorks">
              {{ showHowItWorks ? 'Hide' : 'How it works' }}
            </button>

            <ul v-if="showHowItWorks" class="small mb-0 mt-2 ps-3 text-muted">
              <li>Pick coverage and lock premium before your swap.</li>
              <li>Run your Jupiter swap as usual.</li>
              <li>Kestrel settles automatically if slippage breaches your tier.</li>
            </ul>
          </div>
        </div>
      </div>

      <button 
        @click="handleSwap"
        :disabled="!connected"
        class="btn btn-primary w-100 py-3 fw-bold shadow-sm"
      >
        {{ connected ? 'Swap' : 'Connect Wallet to Swap' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.form-check-input {
  cursor: pointer;
  width: 3em;
  height: 1.5em;
}

.kestrel-inline-logo {
  height: 1em;
  width: auto;
  vertical-align: -0.1em;
  margin: 0 0.3em;
}

.kestrel-select {
  min-width: 240px;
  width: auto;
}

.kestrel-link {
  text-decoration: none;
}
</style>
