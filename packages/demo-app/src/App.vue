<script setup lang="ts">
import { WalletProvider } from '@solana/wallet-adapter-vue';
import { WalletModalProvider } from '@solana/wallet-adapter-vue-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';

import Navbar from './components/Navbar.vue';
import SwapCard from './components/SwapCard.vue';
import SimulateDashboard from './components/SimulateDashboard.vue';

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
];
</script>

<template>
  <WalletProvider :wallets="wallets" auto-connect>
    <WalletModalProvider>
      <div class="bg-light min-vh-100">
        <Navbar />
        
        <main class="container py-5">
          <div class="row justify-content-center">
            <div class="col-md-5">
              <!-- Devnet Disclaimer Banner -->
              <div class="alert alert-warning border-warning border-opacity-50 shadow-sm mb-4">
                <div class="d-flex">
                  <div class="me-3 fs-3">⚠️</div>
                  <div>
                    <h6 class="alert-heading fw-bold mb-1">Solana Devnet Sandbox</h6>
                    <p class="small mb-0 text-dark opacity-75">
                      This is a technical demonstration of Kestrel Protocol. 
                      <strong>No real SOL is being moved.</strong> All transactions occur on the Solana Devnet using testnet assets only.
                    </p>
                  </div>
                </div>
              </div>

              <SwapCard />              <SimulateDashboard class="mt-4" />
            </div>
          </div>
        </main>
      </div>
    </WalletModalProvider>
  </WalletProvider>
</template>

<style>
/* Custom styling to match Solana Wallet UI with Bootstrap */
.wallet-adapter-button-trigger {
  background-color: #0d6efd !important;
  font-family: inherit !important;
  height: 40px !important;
  line-height: 40px !important;
  padding: 0 20px !important;
  border-radius: 0.375rem !important;
}
</style>
