export const CONTRACT_ERROR_MAP: Record<number, string> = {
  1: 'Este vale ya fue liquidado anteriormente (doble canje evitado).',
  2: 'El vale ha vencido o supera la fecha límite de la bóveda.',
  3: 'El monto del vale es inválido o supera el tope por compra autorizado.',
  4: 'Saldo insuficiente en la bóveda del cliente.',
  5: 'No se encontró una bóveda activa en Stellar para este cliente.',
  6: 'La bóveda aún no vence; podrás cerrarla al llegar la fecha límite.',
  7: 'Ya existe una bóveda activa para esta cuenta.',
  8: 'Firma criptográfica inválida (el vale fue alterado).',
  9: 'No tienes autorización para modificar esta bóveda.',
  10: 'La fecha de vencimiento de la bóveda debe ser posterior a hoy.',
  11: 'El contrato ya fue inicializado previamente.',
};

export function parseContractError(rawError: string): { code?: number; message: string } {
  const match = rawError.match(/Error\(Contract,\s*#(\d+)\)/i);
  if (match) {
    const code = Number(match[1]);
    return {
      code,
      message: CONTRACT_ERROR_MAP[code] || `Error del contrato Soroban (#${code}).`,
    };
  }
  if (/ed25519|signature|crypto|InvalidInput/i.test(rawError)) {
    return {
      code: 8,
      message: CONTRACT_ERROR_MAP[8],
    };
  }
  if (/trustline|op_no_trust|balance is not sufficient|missing trustline/i.test(rawError)) {
    return {
      message: 'La cuenta del comercio necesita tener la línea de confianza (trustline) de Soles de prueba (tPEN) activa.',
    };
  }
  return {
    message: 'El contrato rechazó el vale. Verifica que la bóveda exista, tenga saldo y el comercio esté activo.',
  };
}
