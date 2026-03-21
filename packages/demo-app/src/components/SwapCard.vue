<script setup lang="ts">
import { ref, computed } from 'vue';
import { useWallet } from '@solana/wallet-adapter-vue';

const { connected } = useWallet();

const payAmount = ref<number>(1);
const isProtected = ref<boolean>(true);
const premiumBps = ref<number>(15); // Mocked from SDK/API

const receiveAmount = computed(() => {
  const basePrice = 145.20; // Mocked SOL/USDC price
  return (payAmount.value * basePrice).toFixed(2);
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
          <div class="form-check form-switch d-flex justify-content-between align-items-center p-0">
            <label class="form-check-label fw-bold text-primary" for="kestrelToggle">
              🛡️ Protect Execution with Kestrel
            </label>
            <input class="form-check-input ms-0" type="checkbox" id="kestrelToggle" v-model="isProtected">
          </div>
          <div v-if="isProtected" class="mt-2 border-top border-primary border-opacity-25 pt-2 d-flex justify-content-between small">
            <span class="text-muted">Kestrel Premium:</span>
            <span class="fw-bold text-primary">{{ premiumBps }} bps</span>
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
</style>
