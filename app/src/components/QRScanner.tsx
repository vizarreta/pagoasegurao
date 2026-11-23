import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, Clipboard, X } from 'lucide-react';

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
  title?: string;
  expectedPrefix?: string;
}

export const QRScanner: React.FC<QRScannerProps> = ({
  onScan,
  onClose,
  title = 'Escanear Código QR',
  expectedPrefix,
}) => {
  const [manualCode, setManualCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = 'qr-camera-stream';

  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;

    async function startScanner() {
      try {
        html5QrCode = new Html5Qrcode(scannerContainerId);
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            if (expectedPrefix && !decodedText.startsWith(expectedPrefix)) {
              setError(`Código no esperado. Debe iniciar con ${expectedPrefix}`);
              return;
            }
            stopScanner();
            onScan(decodedText);
          },
          () => {
            // ignore frame parse failures
          }
        );
      } catch (err: any) {
        console.warn('Camera start error:', err);
        setError('No se pudo acceder a la cámara. Puedes pegar el código abajo.');
      }
    }

    startScanner();

    return () => {
      stopScanner();
    };
  }, []);

  const stopScanner = () => {
    if (scannerRef.current) {
      if (scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(() => {}).finally(() => {
          try {
            scannerRef.current?.clear();
          } catch {}
          scannerRef.current = null;
        });
      }
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    if (expectedPrefix && !manualCode.trim().startsWith(expectedPrefix)) {
      setError(`El código debe iniciar con ${expectedPrefix}`);
      return;
    }
    stopScanner();
    onScan(manualCode.trim());
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setManualCode(text);
      if (expectedPrefix && !text.trim().startsWith(expectedPrefix)) {
        setError(`El código pegado no inicia con ${expectedPrefix}`);
        return;
      }
      stopScanner();
      onScan(text.trim());
    } catch {
      setError('No se pudo leer del portapapeles');
    }
  };

  return (
    <div className="scanner-modal">
      <div className="scanner-content">
        <div className="scanner-header">
          <h3>
            <Camera size={20} className="inline-icon" /> {title}
          </h3>
          <button className="btn-icon" onClick={() => { stopScanner(); onClose(); }}>
            <X size={20} />
          </button>
        </div>

        <div id={scannerContainerId} className="scanner-viewport"></div>

        {error && <div className="alert alert-warning">{error}</div>}

        <div className="scanner-fallback">
          <p className="subtext">¿Problemas con la cámara? Pega el código manualmente:</p>
          <form onSubmit={handleManualSubmit} className="manual-form">
            <input
              type="text"
              placeholder={`Ej: ${expectedPrefix || 'SSC1...'}...`}
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="input-text"
            />
            <div className="btn-group">
              <button type="button" onClick={handlePaste} className="btn btn-secondary">
                <Clipboard size={16} /> Pegar
              </button>
              <button type="submit" className="btn btn-primary">
                Aceptar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
