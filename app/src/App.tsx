import { useState } from 'react';
import ClienteScreen from './screens/cliente';
import ComercioScreen from './screens/comercio';

export default function App() {
  const [mode, setMode] = useState<'cliente' | 'comercio'>('cliente');
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  return (
    <div className="app">
      <header className="bar">
        <h1>PagoAsegurao</h1>
        <div className="status">
          {online ? 'En línea' : 'Sin conexión'} ·
          {mode === 'cliente' ? 'Cliente' : 'Comercio'}
        </div>
        <div className="toggle" onClick={() => setMode((m) => (m === 'cliente' ? 'comercio' : 'cliente'))}>
          Cambiar a {mode === 'cliente' ? 'comercio' : 'cliente'}
        </div>
      </header>
      <main>
        {mode === 'cliente' ? <ClienteScreen /> : <ComercioScreen />}
      </main>
    </div>
  );
}
