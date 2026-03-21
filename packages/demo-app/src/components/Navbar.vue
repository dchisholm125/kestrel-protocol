<script setup lang="ts">
import { WalletMultiButton } from '@solana/wallet-adapter-vue-ui';
</script>

<template>
  <nav class="navbar navbar-expand-lg navbar-dark bg-dark shadow-sm">
    <div class="container">
      <a class="navbar-brand fw-bold text-primary" href="#">
        KESTREL <span class="text-white">PROTOCOL</span>
        <span class="badge bg-danger ms-2" style="font-size: 0.5em; vertical-align: middle;">DEVNET ONLY</span>
      </a>
      
      <div class="d-flex align-items-center ms-auto">
        <a 
          href="https://faucet.solana.com/" 
          target="_blank" 
          class="btn btn-outline-warning me-3 fw-bold"
        >
          🚰 Get Devnet SOL
        </a>
        <WalletMultiButton />
      </div>
    </div>
  </nav>
</template>
