import { useState } from 'react';

export default function ComercioScreen() {
  const [amount, setAmount] = useState<string>('');
  const [qrA, setQrA] = useState<string>('');
  const [cola, setCola] = useState<{ id: string; monto: string; estado: string }[]>([]);

  const generarQRA = () => {
    setQrA(`SSC1.${btoa(amount)}`);
  };

  const recibirVale = () => {
    setCola((c) => [...c, { id: Date.now().toString(), monto: amount, estado: 'pendiente' }]);
  };

  return (
    <div className="screen comercio">
      <h2>Modo Comercio</h2>
      <label>Monto a cobrar:</label>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" />
      <button onClick={generarQRA}>Mostrar QR-A (cobro)</button>
      {qrA && <div className="qr">{qrA}</div>}
      <button onClick={recibirVale}>Recibir vale (QR-B)</button>
      <h3>Cola de vales</h3>
      <ul>
        {cola.map((v) => (
          <li key={v.id}>{v.monto} — {v.estado}</li>
        ))}
      </ul>
    </div>
  );
}
