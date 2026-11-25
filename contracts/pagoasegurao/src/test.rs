use super::{canonical_message, Error, PagoAsegurao, PagoAseguraoClient, Vault, Voucher};
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::Client as TokenClient,
    token::StellarAssetClient,
    Address, BytesN, Env,
};

fn keypair_from_seed(seed: u8) -> (SigningKey, [u8; 32]) {
    let key = SigningKey::from_bytes(&[seed; 32]);
    let pubkey = key.verifying_key().to_bytes();
    (key, pubkey)
}

fn sign_voucher(
    env: &Env,
    contract_id: &Address,
    voucher: &Voucher,
    signing_key: &SigningKey,
) -> BytesN<64> {
    let msg = canonical_message(env, contract_id, voucher);
    let mut msg_bytes = [0u8; 256];
    let len = msg.len() as usize;
    msg.copy_into_slice(&mut msg_bytes[..len]);
    let sig = signing_key.sign(&msg_bytes[..len]);
    BytesN::from_array(env, &sig.to_bytes())
}

struct TestContext<'a> {
    env: Env,
    contract_id: Address,
    client: PagoAseguraoClient<'a>,
    owner: Address,
    merchant: Address,
    signer_key: SigningKey,
    signer_pub: BytesN<32>,
    token_client: TokenClient<'a>,
}

fn setup<'a>() -> TestContext<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token = token_contract.address();
    let token_client = TokenClient::new(&env, &token);
    let token_admin_client = StellarAssetClient::new(&env, &token);

    // Mint tokens to owner
    token_admin_client.mint(&owner, &100_000_000_000); // 10,000 USDC

    let contract_id = env.register(PagoAsegurao, ());
    let client = PagoAseguraoClient::new(&env, &contract_id);
    client.initialize(&token);

    let (signer_key, pub_bytes) = keypair_from_seed(1);
    let signer_pub = BytesN::from_array(&env, &pub_bytes);

    TestContext {
        env,
        contract_id,
        client,
        owner,
        merchant,
        signer_key,
        signer_pub,
        token_client,
    }
}

// 1. Happy path: open vault, redeem voucher, verify balances
#[test]
fn test_happy_path_open_and_redeem() {
    let tc = setup();
    let initial_balance: i128 = 1_000_000_000; // 100 USDC
    let max_per_voucher: i128 = 200_000_000; // 20 USDC
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &max_per_voucher,
    );

    let vault: Vault = tc.client.get_vault(&tc.signer_pub).unwrap();
    assert_eq!(vault.balance, initial_balance);
    assert_eq!(vault.owner, tc.owner);
    assert_eq!(vault.max_per_voucher, max_per_voucher);

    let voucher_amount: i128 = 50_000_000; // 5 USDC
    let voucher = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: voucher_amount,
        nonce: 101,
        expiry: expires_at,
    };

    let sig = sign_voucher(&tc.env, &tc.contract_id, &voucher, &tc.signer_key);
    tc.client.redeem(&voucher, &sig);

    assert!(tc.client.is_redeemed(&tc.signer_pub, &101));
    let after_vault = tc.client.get_vault(&tc.signer_pub).unwrap();
    assert_eq!(after_vault.balance, initial_balance - voucher_amount);
    assert_eq!(tc.token_client.balance(&tc.merchant), voucher_amount);
}

// 2. Double redeem fails
#[test]
fn test_double_redeem_fails() {
    let tc = setup();
    let initial_balance: i128 = 1_000_000_000;
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &initial_balance,
    );

    let voucher = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: 100_000_000,
        nonce: 202,
        expiry: expires_at,
    };
    let sig = sign_voucher(&tc.env, &tc.contract_id, &voucher, &tc.signer_key);

    tc.client.redeem(&voucher, &sig);
    let res = tc.client.try_redeem(&voucher, &sig);
    assert_eq!(res.err().unwrap().unwrap(), Error::AlreadyRedeemed.into());
}

// 3. Invalid signature (altered message) fails
#[test]
fn test_invalid_signature_fails() {
    let tc = setup();
    let initial_balance: i128 = 1_000_000_000;
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &initial_balance,
    );

    let voucher = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: 100_000_000,
        nonce: 303,
        expiry: expires_at,
    };
    let bad_sig = BytesN::from_array(&tc.env, &[7u8; 64]);
    let res = tc.client.try_redeem(&voucher, &bad_sig);
    assert!(res.is_err());
}

// 4. Voucher signed by other key fails
#[test]
fn test_voucher_signed_by_other_key_fails() {
    let tc = setup();
    let initial_balance: i128 = 1_000_000_000;
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &initial_balance,
    );

    let (other_key, _) = keypair_from_seed(99);
    let voucher = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: 100_000_000,
        nonce: 404,
        expiry: expires_at,
    };
    // Signed with other key but signer field is tc.signer_pub
    let sig = sign_voucher(&tc.env, &tc.contract_id, &voucher, &other_key);
    let res = tc.client.try_redeem(&voucher, &sig);
    assert!(res.is_err());
}

// 5. Expired voucher fails
#[test]
fn test_expired_voucher_fails() {
    let tc = setup();
    let initial_balance: i128 = 1_000_000_000;
    let now = tc.env.ledger().timestamp();
    let expires_at = now + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &initial_balance,
    );

    let expired_time = now - 100;
    let voucher = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: 100_000_000,
        nonce: 505,
        expiry: expired_time,
    };
    let sig = sign_voucher(&tc.env, &tc.contract_id, &voucher, &tc.signer_key);
    let res = tc.client.try_redeem(&voucher, &sig);
    assert_eq!(res.err().unwrap().unwrap(), Error::VoucherExpired.into());
}

// 6. Wrong merchant fails verification
#[test]
fn test_wrong_merchant_fails() {
    let tc = setup();
    let initial_balance: i128 = 1_000_000_000;
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &initial_balance,
    );

    let stranger = Address::generate(&tc.env);
    let voucher_for_merchant = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: 100_000_000,
        nonce: 606,
        expiry: expires_at,
    };
    // Sign for merchant
    let sig = sign_voucher(
        &tc.env,
        &tc.contract_id,
        &voucher_for_merchant,
        &tc.signer_key,
    );

    // Tamper merchant to stranger
    let tampered_voucher = Voucher {
        merchant: stranger,
        ..voucher_for_merchant
    };
    let res = tc.client.try_redeem(&tampered_voucher, &sig);
    assert!(res.is_err());
}

// 7. Amount above max_per_voucher fails
#[test]
fn test_amount_above_max_per_voucher_fails() {
    let tc = setup();
    let initial_balance: i128 = 1_000_000_000;
    let max_per_voucher: i128 = 100_000_000;
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &max_per_voucher,
    );

    let voucher = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: max_per_voucher + 1,
        nonce: 707,
        expiry: expires_at,
    };
    let sig = sign_voucher(&tc.env, &tc.contract_id, &voucher, &tc.signer_key);
    let res = tc.client.try_redeem(&voucher, &sig);
    assert_eq!(res.err().unwrap().unwrap(), Error::InvalidAmount.into());
}

// 8. Insufficient funds fails without state change
#[test]
fn test_insufficient_funds_fails_without_state_change() {
    let tc = setup();
    let initial_balance: i128 = 100_000_000;
    let max_per_voucher: i128 = 60_000_000;
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &max_per_voucher,
    );

    // First voucher spends 60_000_000 (leaving 40_000_000)
    let v1 = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: 60_000_000,
        nonce: 807,
        expiry: expires_at,
    };
    let sig1 = sign_voucher(&tc.env, &tc.contract_id, &v1, &tc.signer_key);
    tc.client.redeem(&v1, &sig1);

    // Second voucher wants 50_000_000 (<= max_per_voucher, but > remaining balance 40_000_000)
    let voucher = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: 50_000_000,
        nonce: 808,
        expiry: expires_at,
    };
    let sig = sign_voucher(&tc.env, &tc.contract_id, &voucher, &tc.signer_key);
    let res = tc.client.try_redeem(&voucher, &sig);
    assert_eq!(res.err().unwrap().unwrap(), Error::InsufficientFunds.into());

    let vault = tc.client.get_vault(&tc.signer_pub).unwrap();
    assert_eq!(vault.balance, 40_000_000);
    assert!(!tc.client.is_redeemed(&tc.signer_pub, &808));
}

// 9. close_vault before expires_at fails; after expires_at succeeds and refunds
#[test]
fn test_close_vault_lifecycle() {
    let tc = setup();
    let initial_balance: i128 = 500_000_000;
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &initial_balance,
    );

    // Attempt close before expiry
    let early_res = tc.client.try_close_vault(&tc.owner, &tc.signer_pub);
    assert_eq!(
        early_res.err().unwrap().unwrap(),
        Error::VaultStillActive.into()
    );

    // Fast-forward past expiry
    tc.env.ledger().set_timestamp(expires_at + 10);
    let balance_before = tc.token_client.balance(&tc.owner);
    tc.client.close_vault(&tc.owner, &tc.signer_pub);

    assert!(tc.client.get_vault(&tc.signer_pub).is_none());
    let balance_after = tc.token_client.balance(&tc.owner);
    assert_eq!(balance_after, balance_before + initial_balance);
}

// 10. Voucher from another contract address fails
#[test]
fn test_voucher_from_another_contract_fails() {
    let tc = setup();
    let initial_balance: i128 = 1_000_000_000;
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &initial_balance,
    );

    let other_contract_id = Address::generate(&tc.env);
    let voucher = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: 100_000_000,
        nonce: 1010,
        expiry: expires_at,
    };
    // Signed targeting other_contract_id
    let sig = sign_voucher(&tc.env, &other_contract_id, &voucher, &tc.signer_key);
    let res = tc.client.try_redeem(&voucher, &sig);
    assert!(res.is_err());
}

// 11. Shared test vector test (reads test-vectors/voucher.json verified by scripts/verify-vector.ts)
fn extract_json_field_start<'a>(json: &'a str, key: &str) -> &'a str {
    let bytes = json.as_bytes();
    let key_bytes = key.as_bytes();
    let mut i = 0;
    while i + key_bytes.len() + 2 <= bytes.len() {
        if bytes[i] == b'"'
            && &bytes[i + 1..i + 1 + key_bytes.len()] == key_bytes
            && bytes[i + 1 + key_bytes.len()] == b'"'
        {
            let mut j = i + 2 + key_bytes.len();
            while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\r' | b'\n') {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b':' {
                j += 1;
                while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\r' | b'\n') {
                    j += 1;
                }
                return &json[j..];
            }
        }
        i += 1;
    }
    panic!("JSON key not found in test vector");
}

fn json_str_field<'a>(json: &'a str, key: &str) -> &'a str {
    let rest = extract_json_field_start(json, key);
    let inner = rest.strip_prefix('"').expect("expected JSON string");
    let end = inner.find('"').expect("unterminated JSON string");
    &inner[..end]
}

fn json_u64_field(json: &str, key: &str) -> u64 {
    let rest = extract_json_field_start(json, key);
    let mut val: u64 = 0;
    let mut digits = 0;
    for b in rest.as_bytes() {
        if b.is_ascii_digit() {
            val = val * 10 + (b - b'0') as u64;
            digits += 1;
        } else {
            break;
        }
    }
    assert!(digits > 0, "expected JSON integer");
    val
}

fn decode_hex_fixed<const N: usize>(hex: &str) -> [u8; N] {
    let b = hex.as_bytes();
    assert_eq!(b.len(), N * 2, "unexpected hex length");
    let nibble = |c: u8| match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => panic!("invalid hex char"),
    };
    let mut out = [0u8; N];
    for i in 0..N {
        out[i] = (nibble(b[i * 2]) << 4) | nibble(b[i * 2 + 1]);
    }
    out
}

#[test]
fn test_shared_test_vector_matches_typescript() {
    let vector_json = include_str!("../test-vectors/voucher.json");
    let contract_str = json_str_field(vector_json, "contract_address");
    let merchant_str = json_str_field(vector_json, "merchant");
    let signer_hex = json_str_field(vector_json, "signer");
    let message_hex = json_str_field(vector_json, "message_hex");
    let signature_hex = json_str_field(vector_json, "signature_hex");
    let amount = json_u64_field(vector_json, "amount") as i128;
    let nonce = json_u64_field(vector_json, "nonce");
    let expiry = json_u64_field(vector_json, "expiry");

    let env = Env::default();
    let contract_id = Address::from_string(&soroban_sdk::String::from_str(&env, contract_str));
    let merchant = Address::from_string(&soroban_sdk::String::from_str(&env, merchant_str));
    let signer_pub = BytesN::from_array(&env, &decode_hex_fixed::<32>(signer_hex));
    let sig = BytesN::from_array(&env, &decode_hex_fixed::<64>(signature_hex));

    let voucher = Voucher {
        signer: signer_pub.clone(),
        merchant,
        amount,
        nonce,
        expiry,
    };

    let msg = canonical_message(&env, &contract_id, &voucher);
    let expected_msg = decode_hex_fixed::<161>(message_hex);
    assert_eq!(msg.len(), 161);
    let mut actual_msg = [0u8; 161];
    msg.copy_into_slice(&mut actual_msg);
    assert_eq!(actual_msg, expected_msg);

    // Cryptographic verification must pass using the exact signature loaded from test-vectors/voucher.json
    env.crypto().ed25519_verify(&signer_pub, &msg, &sig);
}

// 12. Unauthorized close_vault by non-owner fails
#[test]
fn test_close_vault_unauthorized_fails() {
    let tc = setup();
    let initial_balance: i128 = 500_000_000;
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &initial_balance,
    );

    tc.env.ledger().set_timestamp(expires_at + 10);
    let attacker = Address::generate(&tc.env);
    let res = tc.client.try_close_vault(&attacker, &tc.signer_pub);
    assert_eq!(res.err().unwrap().unwrap(), Error::Unauthorized.into());

    // Original owner can still close and recover full balance
    let balance_before = tc.token_client.balance(&tc.owner);
    tc.client.close_vault(&tc.owner, &tc.signer_pub);
    assert_eq!(
        tc.token_client.balance(&tc.owner),
        balance_before + initial_balance
    );
}

// 13. top_up increases balance and rejects unauthorized caller
#[test]
fn test_top_up_authorized_and_unauthorized() {
    let tc = setup();
    let initial_balance: i128 = 200_000_000;
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &initial_balance,
    );

    let stranger = Address::generate(&tc.env);
    let bad = tc.client.try_top_up(&stranger, &tc.signer_pub, &50_000_000);
    assert_eq!(bad.err().unwrap().unwrap(), Error::Unauthorized.into());

    tc.client.top_up(&tc.owner, &tc.signer_pub, &50_000_000);
    let vault = tc.client.get_vault(&tc.signer_pub).unwrap();
    assert_eq!(vault.balance, initial_balance + 50_000_000);
}

// 14. open_vault with past expiry fails
#[test]
fn test_open_vault_past_expiry_fails() {
    let tc = setup();
    let past = tc.env.ledger().timestamp() - 1;
    let res = tc
        .client
        .try_open_vault(&tc.owner, &tc.signer_pub, &100_000_000, &past, &50_000_000);
    assert_eq!(res.err().unwrap().unwrap(), Error::InvalidExpiry.into());
}

// 15. Voucher with expiry beyond vault expires_at fails
#[test]
fn test_voucher_expiry_after_vault_expiry_fails() {
    let tc = setup();
    let initial_balance: i128 = 500_000_000;
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &initial_balance,
    );

    let voucher = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: 50_000_000,
        nonce: 1515,
        expiry: expires_at + 1,
    };
    let sig = sign_voucher(&tc.env, &tc.contract_id, &voucher, &tc.signer_key);
    let res = tc.client.try_redeem(&voucher, &sig);
    assert_eq!(res.err().unwrap().unwrap(), Error::VoucherExpired.into());
}

// 16. open_vault with max_per_voucher > amount fails
#[test]
fn test_open_vault_max_per_voucher_greater_than_amount_fails() {
    let tc = setup();
    let expires_at = tc.env.ledger().timestamp() + 86400;
    let res = tc.client.try_open_vault(
        &tc.owner,
        &tc.signer_pub,
        &100_000_000,
        &expires_at,
        &150_000_000,
    );
    assert_eq!(res.err().unwrap().unwrap(), Error::InvalidAmount.into());
}

// 17. open_vault with zero or negative amount fails
#[test]
fn test_open_vault_zero_amount_fails() {
    let tc = setup();
    let expires_at = tc.env.ledger().timestamp() + 86400;
    let res = tc
        .client
        .try_open_vault(&tc.owner, &tc.signer_pub, &0, &expires_at, &0);
    assert_eq!(res.err().unwrap().unwrap(), Error::InvalidAmount.into());
}

// 18. top_up after vault expiration fails
#[test]
fn test_top_up_after_expiry_fails() {
    let tc = setup();
    let initial_balance: i128 = 200_000_000;
    let expires_at = tc.env.ledger().timestamp() + 100;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &initial_balance,
    );

    tc.env.ledger().set_timestamp(expires_at + 1);
    let res = tc.client.try_top_up(&tc.owner, &tc.signer_pub, &50_000_000);
    assert_eq!(res.err().unwrap().unwrap(), Error::VoucherExpired.into());
}

// 19. top_up on non-existent vault fails
#[test]
fn test_top_up_nonexistent_vault_fails() {
    let tc = setup();
    let res = tc.client.try_top_up(&tc.owner, &tc.signer_pub, &50_000_000);
    assert_eq!(res.err().unwrap().unwrap(), Error::VaultNotFound.into());
}

// 20. redeem with zero amount fails
#[test]
fn test_redeem_zero_amount_fails() {
    let tc = setup();
    let initial_balance: i128 = 200_000_000;
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &initial_balance,
    );

    let voucher = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: 0,
        nonce: 42,
        expiry: expires_at - 100,
    };
    let sig = sign_voucher(&tc.env, &tc.contract_id, &voucher, &tc.signer_key);
    let res = tc.client.try_redeem(&voucher, &sig);
    assert_eq!(res.err().unwrap().unwrap(), Error::InvalidAmount.into());
}

// 21. double initialize fails with AlreadyInitialized
#[test]
fn test_double_initialize_fails() {
    let tc = setup();
    let token_admin = Address::generate(&tc.env);
    let other_token = tc.env.register_stellar_asset_contract_v2(token_admin);
    let res = tc.client.try_initialize(&other_token.address());
    assert_eq!(
        res.err().unwrap().unwrap(),
        Error::AlreadyInitialized.into()
    );
}
