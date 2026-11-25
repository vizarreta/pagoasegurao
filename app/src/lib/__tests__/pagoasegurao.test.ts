import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TESTNET_CONFIG,
  randomKeypair,
  parseAmountToStroops,
  formatStroops,
  formatSoles,
  mapSorobanError,
  buildCanonicalMessage,
  verifySignature,
} from '../stellar';
import { CONTRACT_ERROR_MAP, parseContractError } from '../../../../api/_errors';
import { base64urlEncode, base64urlDecode, generateNonce, generateRequestId } from '../qr';
import { encodeQRA, decodeQRA, encodeQRB, decodeQRB, verifyVoucherLocally } from '../voucher';

describe('Fixed-point BigInt Soles (tPEN) arithmetic', () => {
  it('parses decimal strings into exact 7-decimal stroops without floats', () => {
    assert.equal(parseAmountToStroops('1'), 10_000_000n);
    assert.equal(parseAmountToStroops('5.50'), 55_000_000n);
    assert.equal(parseAmountToStroops('12,3456789'), 123_456_789n);
    assert.equal(parseAmountToStroops('0.0000001'), 1n);
    assert.equal(parseAmountToStroops(' 200.00 '), 2_000_000_000n);
  });

  it('rejects zero, negative, malformed, or >7 decimal inputs', () => {
    assert.equal(parseAmountToStroops('0'), null);
    assert.equal(parseAmountToStroops('0.00'), null);
    assert.equal(parseAmountToStroops('-10'), null);
    assert.equal(parseAmountToStroops('1.12345678'), null);
    assert.equal(parseAmountToStroops('abc'), null);
  });

  it('formats stroops cleanly without float precision loss', () => {
    assert.equal(formatStroops(100_000_000n), '10.00');
    assert.equal(formatStroops(123_456_789n), '12.3456789');
    assert.equal(formatStroops(1n), '0.0000001');
    assert.equal(formatSoles(150_000_000n), `${TESTNET_CONFIG.assetSymbol} 15.00`);
  });
});

describe('Shared Soroban contract error mapping (#1-#11)', () => {
  it('maps every contract error code consistently between API and app', () => {
    for (const [codeStr, expectedMsg] of Object.entries(CONTRACT_ERROR_MAP)) {
      const raw = `Simulation failed: HostError: Error(Contract, #${codeStr})`;
      assert.equal(mapSorobanError(raw), expectedMsg);
      assert.equal(parseContractError(raw).message, expectedMsg);
      assert.equal(parseContractError(raw).code, Number(codeStr));
    }
  });
});

describe('Compact QR encoding and offline Ed25519 voucher verification', () => {
  it('round-trips base64url without padding or unsafe URL characters', () => {
    const sample = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = base64urlEncode(sample);
    assert.ok(!encoded.includes('+') && !encoded.includes('/') && !encoded.includes('='));
    assert.deepEqual(base64urlDecode(encoded), sample);
    assert.equal(generateRequestId().length, 8);
    assert.notEqual(generateNonce(), generateNonce());
  });

  it('encodes and decodes QR-A (SSC1.) and QR-B (SSV1.) under 300 chars and validates offline', () => {
    const clientKp = randomKeypair();
    const merchantKp = randomKeypair();
    const amount = 150_000_000n; // S/ 15.00
    const futureExpiry = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const qra = encodeQRA(merchantKp.publicKey(), amount);
    assert.ok(qra.startsWith('SSC1.'));
    assert.ok(qra.length < 100);

    const decodedA = decodeQRA(qra);
    assert.ok(decodedA);
    assert.equal(decodedA.merchantAddress, merchantKp.publicKey());
    assert.equal(decodedA.amount, amount);

    const { qrString: qrb } = encodeQRB(
      TESTNET_CONFIG.contractId,
      clientKp,
      decodedA.merchantAddress,
      decodedA.amount,
      futureExpiry
    );
    assert.ok(qrb.startsWith('SSV1.'));
    assert.ok(qrb.length <= 220);

    const decodedB = decodeQRB(qrb);
    assert.ok(decodedB);
    assert.equal(decodedB.signerAddress, clientKp.publicKey());
    assert.equal(decodedB.merchantAddress, merchantKp.publicKey());
    assert.equal(decodedB.amount, amount);

    // Valid check
    const ok = verifyVoucherLocally(TESTNET_CONFIG.contractId, decodedB, merchantKp.publicKey(), amount);
    assert.equal(ok.valid, true);

    // Wrong merchant fails
    const otherMerchant = randomKeypair();
    const wrongMerchant = verifyVoucherLocally(TESTNET_CONFIG.contractId, decodedB, otherMerchant.publicKey(), amount);
    assert.equal(wrongMerchant.valid, false);

    // Wrong charge amount fails
    const wrongAmount = verifyVoucherLocally(TESTNET_CONFIG.contractId, decodedB, merchantKp.publicKey(), 200_000_000n);
    assert.equal(wrongAmount.valid, false);

    // Wrong contractId fails signature verification
    const wrongContract = verifyVoucherLocally(
      'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
      decodedB,
      merchantKp.publicKey(),
      amount
    );
    assert.equal(wrongContract.valid, false);

    // Tampered signature fails
    const tamperedPayload = {
      ...decodedB,
      signature: new Uint8Array(decodedB.signature.map((b, idx) => (idx === 0 ? b ^ 0xff : b))),
    };
    const tamperedSig = verifyVoucherLocally(TESTNET_CONFIG.contractId, tamperedPayload, merchantKp.publicKey(), amount);
    assert.equal(tamperedSig.valid, false);
  });

  it('rejects expired vouchers locally', () => {
    const clientKp = randomKeypair();
    const merchantKp = randomKeypair();
    const pastExpiry = BigInt(Math.floor(Date.now() / 1000) - 60);

    const { qrString } = encodeQRB(TESTNET_CONFIG.contractId, clientKp, merchantKp.publicKey(), 50_000_000n, pastExpiry);
    const decoded = decodeQRB(qrString);
    assert.ok(decoded);
    const check = verifyVoucherLocally(TESTNET_CONFIG.contractId, decoded, merchantKp.publicKey(), 50_000_000n);
    assert.equal(check.valid, false);
  });
});

describe('Cross-language shared test vector', () => {
  it('matches contracts/pagoasegurao/test-vectors/voucher.json', () => {
    const vectorPath = path.resolve(process.cwd(), '..', 'contracts', 'pagoasegurao', 'test-vectors', 'voucher.json');
    const fallbackPath = path.resolve(process.cwd(), 'contracts', 'pagoasegurao', 'test-vectors', 'voucher.json');
    const resolved = fs.existsSync(vectorPath) ? vectorPath : fallbackPath;
    const vector = JSON.parse(fs.readFileSync(resolved, 'utf8'));

    const signerPub = Buffer.from(vector.signer, 'hex');
    const msg = buildCanonicalMessage(
      vector.contract_address,
      signerPub,
      vector.merchant,
      BigInt(vector.amount),
      BigInt(vector.nonce),
      BigInt(vector.expiry)
    );
    assert.equal(msg.length, 161);
    assert.equal(msg.toString('hex'), vector.message_hex);
    assert.equal(verifySignature(signerPub, msg, Buffer.from(vector.signature_hex, 'hex')), vector.expected_valid);
  });
});
