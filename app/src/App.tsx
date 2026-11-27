import { useState, useEffect } from 'react';
import ClienteScreen from './screens/cliente';
import ComercioScreen from './screens/comercio';
import { TESTNET_CONFIG } from './lib/stellar';
import { Wifi, WifiOff, User, Store, Shield, ExternalLink } from 'lucide-react';
import './App.css';

const ROLE_STORAGE_KEY = 'pagoasegurao_active_role';

export default function App() {
  const [mode, setMode] = useState<'cliente' | 'comercio'>(() => {
    try {
      const saved = localStorage.getItem(ROLE_STORAGE_KEY);
      if (saved === 'cliente' || saved === 'comercio') return saved;
    } catch {}
    return 'cliente';
  });
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const handleSelectMode = (nextMode: 'cliente' | 'comercio') => {
    setMode(nextMode);
    try {
      localStorage.setItem(ROLE_STORAGE_KEY, nextMode);
    } catch {}
  };

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div className="app-container">
      {/* Top Bar */}
      <header className="app-header">
        <div className="brand-group">
          <div className="brand-logo">
            <Shield size={22} />
          </div>
          <div className="brand-titles">
            <h1 className="brand-name">PagoAsegurao</h1>
            <span className="brand-tagline">Tu pago, asegurao, con o sin señal</span>
          </div>
        </div>

        <div className={`connection-pill ${online ? 'online' : 'offline'}`}>
          {online ? (
            <>
              <span className="pulse-dot"></span>
              <Wifi size={14} /> En línea
            </>
          ) : (
            <>
              <WifiOff size={14} /> Sin conexión
            </>
          )}
        </div>
      </header>

      {/* Role Navigation Tabs */}
      <nav className="role-nav">
        <button
          className={`nav-btn ${mode === 'cliente' ? 'active' : ''}`}
          onClick={() => handleSelectMode('cliente')}
        >
          <User size={18} />
          <span>Cliente (Pagar)</span>
        </button>

        <button
          className={`nav-btn ${mode === 'comercio' ? 'active' : ''}`}
          onClick={() => handleSelectMode('comercio')}
        >
          <Store size={18} />
          <span>Comercio (Cobrar)</span>
        </button>
      </nav>

      {/* Main View */}
      <main className="app-main">
        {mode === 'cliente' ? <ClienteScreen /> : <ComercioScreen />}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <span>Stellar Testnet · Contrato Soroban </span>
        <a
          href={`${TESTNET_CONFIG.explorerBase}/contract/${TESTNET_CONFIG.contractId}`}
          target="_blank"
          rel="noreferrer"
          className="link-explorer"
        >
          {TESTNET_CONFIG.contractId.slice(0, 6)}...{TESTNET_CONFIG.contractId.slice(-4)}{' '}
          <ExternalLink size={11} />
        </a>
      </footer>
    </div>
  );
}
