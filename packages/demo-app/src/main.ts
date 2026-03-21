import { createApp } from 'vue';
import App from './App.vue';

// Bootstrap CSS & JS
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap';

// Solana Wallet Adapter CSS
import '../node_modules/@solana/wallet-adapter-vue-ui/styles.css';

createApp(App).mount('#app');
