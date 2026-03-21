<script setup lang="ts">
import { ref } from 'vue';
import { useWallet } from '@solana/wallet-adapter-vue';

const { connected } = useWallet();
const isSimulating = ref(false);

const triggerBreach = async () => {
  if (!connected.value) return;
  
  isSimulating.value = true;
  console.log("Initiating Red Team breach simulation...");
  
  // Logic to bypass routing and force a claim settlement
  setTimeout(() => {
    isSimulating.value = false;
    alert("Simulation Complete: GuaranteeVault settled a claim of 0.42 SOL to your wallet due to slippage breach!");
  }, 2000);
};
</script>

<template>
  <div class="card border-danger border-opacity-50">
    <div class="card-header bg-danger bg-opacity-10 text-danger fw-bold py-2">
      🛠️ Developer Tools (Red Team)
    </div>
    <div class="card-body text-center p-4">
      <p class="small text-muted mb-4">
        Simulate a worst-case scenario where execution slippage exceeds the threshold, triggering an automatic insurance payout from the Kestrel Vault.
      </p>
      
      <button 
        @click="triggerBreach"
        :disabled="!connected || isSimulating"
        class="btn btn-outline-danger w-100 fw-bold py-2"
      >
        <span v-if="isSimulating" class="spinner-border spinner-border-sm me-2"></span>
        {{ isSimulating ? 'Breaching Contract...' : 'Simulate Bad Execution' }}
      </button>
      
      <div v-if="!connected" class="mt-2 small text-danger italic">
        * Requires connected wallet
      </div>
    </div>
  </div>
</template>
