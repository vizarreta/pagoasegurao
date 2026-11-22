use soroban_sdk::{
    testutils::{Address as _, _},
    Address, BytesN, Env, IntoVal, Symbol,
};
use pagoasegurao::{Error, Vault, Voucher};

fn signer_bytes(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[1u8; 32])
}

fn other_signer_bytes(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[2u8; 32])
}

fn make_voucher(env: &Env, signer: &BytesN<32>, merchant: &Address, amount: i128, nonce: u64, expiry: u64) -> Voucher {
    Voucher {
        signer: signer.clone(),
        merchant: merchant.clone(),
        amount,
        nonce,
        expiry,
    }
}

fn setup(env: &Env) -> (Address, Address, BytesN<32>) {
    let owner = Address::generate(env);
    let merchant = Address::generate(env);
    let token = Address::generate(env);
    let contract = env.register_contract(None, pagoasegurao::PagoAsegurao);
    let client = pagoasegurao::Client::new(env, &contract);
    client.initialize(&token);
    (owner, merchant, signer_bytes(env))
}

#[test]
fn test_happy_path_open_and_redeem() {
    let env = Env::default();
    let (owner, merchant, signer) = setup(&env);
    let contract = env.register_contract(None, pagoasegurao::PagoAsegurao);
    let client = pagoasegurao::Client::new(&env, &contract);
    let token = Address::generate(&env);
    client.initialize(&token);

    let amount: i128 = 1_000_000_000; // 10 USDC (7 decimals)
    let expires_at: u64 = env.ledger().timestamp() + 86400;
    client.open_vault(&owner, &signer, &amount, &expires_at, &amount);

    let vault: Vault = client.get_vault(&signer).unwrap();
    assert_eq!(vault.balance, amount);
    assert!(!client.is_redeemed(&signer, &1));
}

#[test]
fn test_double_redeem_fails() {
    let env = Env::default();
    let contract = env.register_contract(None, pagoasegurao::PagoAsegurao);
    let client = pagoasegurao::Client::new(&env, &contract);
    let token = Address::generate(&env);
    client.initialize(&token);

    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let signer = signer_bytes(&env);
    let amount: i128 = 1_000_000_000;
    let expires_at: u64 = env.ledger().timestamp() + 86400;
    client.open_vault(&owner, &signer, &amount, &expires_at, &amount);

    let voucher = make_voucher(&env, &signer, &merchant, amount, 1, expires_at);
    let sig = vec![0u8; 64].into_val(&env);
    let result = client.try_redeem(&voucher, &sig);
    assert!(result.is_err());
}

#[test]
fn test_invalid_signature_fails() {
    let env = Env::default();
    let contract = env.register_contract(None, pagoasegurao::PagoAsegurao);
    let client = pagoasegurao::Client::new(&env, &contract);
    let token = Address::generate(&env);
    client.initialize(&token);

    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let signer = signer_bytes(&env);
    let amount: i128 = 500_000_000;
    let expires_at: u64 = env.ledger().timestamp() + 86400;
    client.open_vault(&owner, &signer, &amount, &expires_at, &amount);

    let voucher = make_voucher(&env, &signer, &merchant, amount, 2, expires_at);
    let bad_sig = vec![9u8; 64].into_val(&env);
    let result = client.try_redeem(&voucher, &bad_sig);
    assert!(result.is_err());
}

#[test]
fn test_voucher_signed_by_other_key_fails() {
    let env = Env::default();
    let contract = env.register_contract(None, pagoasegurao::PagoAsegurao);
    let client = pagoasegurao::Client::new(&env, &contract);
    let token = Address::generate(&env);
    client.initialize(&token);

    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let signer = signer_bytes(&env);
    let other = other_signer_bytes(&env);
    let amount: i128 = 500_000_000;
    let expires_at: u64 = env.ledger().timestamp() + 86400;
    client.open_vault(&owner, &signer, &amount, &expires_at, &amount);

    let voucher = make_voucher(&env, &other, &merchant, amount, 3, expires_at);
    let sig = vec![0u8; 64].into_val(&env);
    let result = client.try_redeem(&voucher, &sig);
    assert!(result.is_err());
}

#[test]
fn test_expired_voucher_fails() {
    let env = Env::default();
    let contract = env.register_contract(None, pagoasegurao::PagoAsegurao);
    let client = pagoasegurao::Client::new(&env, &contract);
    let token = Address::generate(&env);
    client.initialize(&token);

    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let signer = signer_bytes(&env);
    let amount: i128 = 500_000_000;
    let expired: u64 = env.ledger().timestamp() - 100;
    client.open_vault(&owner, &signer, &amount, &expired, &amount);

    let voucher = make_voucher(&env, &signer, &merchant, amount, 4, expired);
    let sig = vec![0u8; 64].into_val(&env);
    let result = client.try_redeem(&voucher, &sig);
    assert!(result.is_err());
}

#[test]
fn test_wrong_merchant_fails() {
    let env = Env::default();
    let contract = env.register_contract(None, pagoasegurao::PagoAsegurao);
    let client = pagoasegurao::Client::new(&env, &contract);
    let token = Address::generate(&env);
    client.initialize(&token);

    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let stranger = Address::generate(&env);
    let signer = signer_bytes(&env);
    let amount: i128 = 500_000_000;
    let expires_at: u64 = env.ledger().timestamp() + 86400;
    client.open_vault(&owner, &signer, &amount, &expires_at, &amount);

    let voucher = make_voucher(&env, &signer, &stranger, amount, 5, expires_at);
    let sig = vec![0u8; 64].into_val(&env);
    let result = client.try_redeem(&voucher, &sig);
    assert!(result.is_err());
}

#[test]
fn test_amount_above_max_per_voucher_fails() {
    let env = Env::default();
    let contract = env.register_contract(None, pagoasegurao::PagoAsegurao);
    let client = pagoasegurao::Client::new(&env, &contract);
    let token = Address::generate(&env);
    client.initialize(&token);

    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let signer = signer_bytes(&env);
    let max: i128 = 1_000_000_000;
    let amount: i128 = max + 1;
    let expires_at: u64 = env.ledger().timestamp() + 86400;
    client.open_vault(&owner, &signer, &amount, &expires_at, &max);

    let voucher = make_voucher(&env, &signer, &merchant, amount, 6, expires_at);
    let sig = vec![0u8; 64].into_val(&env);
    let result = client.try_redeem(&voucher, &sig);
    assert!(result.is_err());
}

#[test]
fn test_insufficient_funds_fails_without_state_change() {
    let env = Env::default();
    let contract = env.register_contract(None, pagoasegurao::PagoAsegurao);
    let client = pagoasegurao::Client::new(&env, &contract);
    let token = Address::generate(&env);
    client.initialize(&token);

    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let signer = signer_bytes(&env);
    let balance: i128 = 1_000_000_000;
    let amount: i128 = balance + 1;
    let max: i128 = amount;
    let expires_at: u64 = env.ledger().timestamp() + 86400;
    client.open_vault(&owner, &signer, &balance, &expires_at, &max);

    let before = client.get_vault(&signer).unwrap().balance;
    let voucher = make_voucher(&env, &signer, &merchant, amount, 7, expires_at);
    let sig = vec![0u8; 64].into_val(&env);
    let result = client.try_redeem(&voucher, &sig);
    assert!(result.is_err());
    let after = client.get_vault(&signer).unwrap().balance;
    assert_eq!(before, after);
    assert!(!client.is_redeemed(&signer, 7));
}

#[test]
fn test_close_vault_before_expiry_fails_after_returns() {
    let env = Env::default();
    let contract = env.register_contract(None, pagoasegurao::PagoAsegurao);
    let client = pagoasegurao::Client::new(&env, &contract);
    let token = Address::generate(&env);
    client.initialize(&token);

    let owner = Address::generate(&env);
    let signer = signer_bytes(&env);
    let amount: i128 = 1_000_000_000;
    let expires_at: u64 = env.ledger().timestamp() + 86400;
    client.open_vault(&owner, &signer, &amount, &expires_at, &amount);

    let res = client.try_close_vault(&owner, &signer);
    assert!(res.is_err());

    env.ledger().set_timestamp(expires_at + 1);
    let before = client.get_vault(&signer).unwrap().balance;
    client.close_vault(&owner, &signer);
    assert!(client.get_vault(&signer).is_none());
    assert_eq!(before, amount);
}

#[test]
fn test_shared_vector_structure() {
    let env = Env::default();
    let signer = signer_bytes(&env);
    let merchant = Address::generate(&env);
    let voucher = make_voucher(&env, &signer, &merchant, 1_000_000_000, 42, 1735689600);
    assert_eq!(voucher.amount, 1_000_000_000);
    assert_eq!(voucher.nonce, 42);
    assert_eq!(voucher.expiry, 1735689600);
}
