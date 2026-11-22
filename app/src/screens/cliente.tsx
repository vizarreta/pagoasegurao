import { useState } from 'react';
import { randomKeypair, publicKeyToStrKey } from '../lib/stellar';

export default function ClienteScreen() {
  const [step, setStep] = useState<'inicio' | 'cuenta' | 'boveda' | 'pagar'>('inicio');
  const [publicKey, setPublicKey] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [qr, setQr] = useState<string>('');

  const crearCuenta = () => {
    const kp = randomKeypair();
    setPublicKey(publicKeyToStrKey(kp.publicKey()));
    setStep('cuenta');
  };

  return (
    <div className="screen cliente">
      <h2>Modo Cliente</h2>
      {step === 'inicio' && (
        <>
          <p>Crea una cuenta de prueba y abre una bóveda antes de quedarte sin señal.</p>
          <button onClick={crearCuenta}>Crear cuenta de prueba</button>
        </>
      )}
      {step === 'cuenta' && (
        <>
          <p>Cuenta: {publicKey}</p>
          <label>Monto a apartar (unidades mínimas):</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" />
          <button onClick={() => setStep('boveda')}>Abrir bóveda</button>
        </>
      )}
      {step === 'boveda' && (
        <>
          <p>Bóveda abierta para {amount}.</p>
          <button onClick={() => setStep('pagar')}>Pagar (escanear QR del comercio)</button>
        </>
      )}
      {step === 'pagar' && (
        <>
          <p>Escanea el QR-A del comercio, confirma y muestra este QR-B:</p>
          <div className="qr">{qr || '(QR-B del vale)'}</div>
          <button onClick={() => setStep('inicio')}>Volver</button>
        </>
      )}
    </div>
  );
}
