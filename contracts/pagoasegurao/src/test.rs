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
    let expires_at = tc.env.ledger().timestamp() + 86400;

    tc.client.open_vault(
        &tc.owner,
        &tc.signer_pub,
        &initial_balance,
        &expires_at,
        &1_000_000_000,
    );

    let voucher = Voucher {
        signer: tc.signer_pub.clone(),
        merchant: tc.merchant.clone(),
        amount: initial_balance + 1,
        nonce: 808,
        expiry: expires_at,
    };
    let sig = sign_voucher(&tc.env, &tc.contract_id, &voucher, &tc.signer_key);
    let res = tc.client.try_redeem(&voucher, &sig);
    assert_eq!(res.err().unwrap().unwrap(), Error::InsufficientFunds.into());

    let vault = tc.client.get_vault(&tc.signer_pub).unwrap();
    assert_eq!(vault.balance, initial_balance);
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

// 11. Shared test vector test (matches scripts/verify-vector.ts and test-vectors/voucher.json)
#[test]
fn test_shared_test_vector_matches_typescript() {
    let env = Env::default();
    let contract_id = Address::from_string(&soroban_sdk::String::from_str(
        &env,
        "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
    ));
    let merchant = Address::from_string(&soroban_sdk::String::from_str(
        &env,
        "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA",
    ));

    // Signer public key from seed [42; 32]
    let signer_bytes: [u8; 32] = [
        0x19, 0x7f, 0x6b, 0x23, 0xe1, 0x6c, 0x85, 0x32, 0xc6, 0xab, 0xc8, 0x38, 0xfa, 0xcd, 0x5e,
        0xa7, 0x89, 0xbe, 0x0c, 0x76, 0xb2, 0x92, 0x03, 0x34, 0x03, 0x9b, 0xfa, 0x8b, 0x3d, 0x36,
        0x8d, 0x61,
    ];
    let signer_pub = BytesN::from_array(&env, &signer_bytes);

    let voucher = Voucher {
        signer: signer_pub.clone(),
        merchant,
        amount: 10_000_000,
        nonce: 42,
        expiry: 1735689600,
    };

    let expected_sig_bytes: [u8; 64] = [
        0xbe, 0xfe, 0xc6, 0x23, 0x22, 0xbf, 0x84, 0x58, 0x01, 0x84, 0xf4, 0x0f, 0x88, 0xfa, 0x8a,
        0x21, 0xb9, 0x27, 0x3c, 0x09, 0xef, 0x4e, 0x60, 0x17, 0xa2, 0x2c, 0x3c, 0xd4, 0x90, 0x8d,
        0x33, 0x90, 0x1f, 0x28, 0x29, 0x86, 0x5b, 0xcf, 0xef, 0x8a, 0x48, 0xb3, 0xe6, 0xc1, 0xbf,
        0xc0, 0x25, 0x9c, 0x3e, 0x38, 0xf1, 0x0d, 0x20, 0x73, 0x5a, 0x28, 0xdd, 0xa7, 0x36, 0xd8,
        0x9d, 0x6d, 0x5d, 0x06,
    ];
    let sig = BytesN::from_array(&env, &expected_sig_bytes);

    let msg = canonical_message(&env, &contract_id, &voucher);
    assert_eq!(msg.len(), 161);

    // Cryptographic verification must pass using the exact signature generated by TypeScript
    env.crypto().ed25519_verify(&signer_pub, &msg, &sig);

    // Cryptographic verification must pass
    env.crypto().ed25519_verify(&signer_pub, &msg, &sig);
}
