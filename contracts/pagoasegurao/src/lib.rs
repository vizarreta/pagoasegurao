#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Bytes, Env, Symbol,
    Vec, panic_with_error,
};

const MAGIC: &[u8; 13] = b"PAGOASEGURAO1";

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Vault {
    pub owner: Address,
    pub balance: i128,
    pub expires_at: u64,
    pub max_per_voucher: i128,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Voucher {
    pub signer: BytesN<32>,
    pub merchant: Address,
    pub amount: i128,
    pub nonce: u64,
    pub expiry: u64,
}

#[contracttype]
pub enum DataKey {
    Token,
    Vault(BytesN<32>),
    Used(BytesN<32>, u64),
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
pub enum Error {
    AlreadyRedeemed = 1,
    VoucherExpired = 2,
    InvalidAmount = 3,
    InsufficientFunds = 4,
    VaultNotFound = 5,
    VaultStillActive = 6,
    VaultExists = 7,
    InvalidSignature = 8,
}

#[contract]
pub struct PagoAsegurao;

#[contractimpl]
impl PagoAsegurao {
    pub fn initialize(env: Env, token: Address) {
        env.storage().instance().set(&DataKey::Token, &token);
    }

    pub fn open_vault(
        env: Env,
        owner: Address,
        signer: BytesN<32>,
        amount: i128,
        expires_at: u64,
        max_per_voucher: i128,
    ) {
        owner.require_auth();

        if amount <= 0 || max_per_voucher <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not initialized");

        if env.storage().persistent().has(&DataKey::Vault(signer.clone())) {
            panic_with_error!(&env, Error::VaultExists);
        }

        let contract_id = env.current_contract_address();
        env.invoke_contract(
            &token,
            &Symbol::short("transfer"),
            (owner, contract_id.clone(), amount).into_val(&env),
        );

        let vault = Vault {
            owner,
            balance: amount,
            expires_at,
            max_per_voucher,
        };
        let ttl = expires_at.saturating_add(7 * 86400);
        env.storage().persistent().set(&DataKey::Vault(signer.clone()), &vault);
        env.storage().persistent().extend_ttl(&DataKey::Vault(signer), ttl, ttl);
    }

    pub fn top_up(env: Env, owner: Address, signer: BytesN<32>, amount: i128) {
        owner.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let token: Address = env.storage().instance().get(&DataKey::Token).expect("token not initialized");
        let contract_id = env.current_contract_address();
        env.invoke_contract(
            &token,
            &Symbol::short("transfer"),
            (owner, contract_id.clone(), amount).into_val(&env),
        );

        let mut vault: Vault = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(signer.clone()))
            .ok_or(Error::VaultNotFound)
            .unwrap();
        vault.balance = vault.balance.saturating_add(amount);
        env.storage().persistent().set(&DataKey::Vault(signer.clone()), &vault);
    }

    pub fn redeem(env: Env, voucher: Voucher, signature: Bytes) {
        // 1. nonce not used
        if env.storage().persistent().has(&DataKey::Used(voucher.signer.clone(), voucher.nonce)) {
            panic_with_error!(&env, Error::AlreadyRedeemed);
        }

        // 2. expiry checks
        let now = env.ledger().timestamp();
        if now > voucher.expiry {
            panic_with_error!(&env, Error::VoucherExpired);
        }
        let vault: Vault = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(voucher.signer.clone()))
            .ok_or(Error::VaultNotFound)
            .unwrap();
        if voucher.expiry > vault.expires_at {
            panic_with_error!(&env, Error::VoucherExpired);
        }

        // 3. amount checks
        if voucher.amount <= 0 || voucher.amount > vault.max_per_voucher {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        // 4. signature verification over canonical message
        let contract_id = env.current_contract_address();
        let msg = canonical_message(&env, &contract_id, &voucher);
        if !env.crypto().ed25519_verify(&voucher.signer, &msg, &signature) {
            panic_with_error!(&env, Error::InvalidSignature);
        }

        // 5. sufficient funds
        if vault.balance < voucher.amount {
            panic_with_error!(&env, Error::InsufficientFunds);
        }

        // 6. effects first: mark nonce used and deduct balance
        env.storage()
            .persistent()
            .set(&DataKey::Used(voucher.signer.clone(), voucher.nonce), &true);
        let mut new_vault = vault;
        new_vault.balance = new_vault.balance.saturating_sub(voucher.amount);
        env.storage()
            .persistent()
            .set(&DataKey::Vault(voucher.signer.clone()), &new_vault);

        // 7. transfer to merchant (relayer may be the caller; funds go to merchant)
        let token: Address = env.storage().instance().get(&DataKey::Token).expect("token not initialized");
        env.invoke_contract(
            &token,
            &Symbol::short("transfer"),
            (contract_id, voucher.merchant.clone(), voucher.amount).into_val(&env),
        );

        // 8. event
        env.events().publish(
            (Symbol::short("redeemed"), voucher.signer.clone(), voucher.merchant.clone()),
            (voucher.amount, voucher.nonce),
        );
    }

    pub fn close_vault(env: Env, owner: Address, signer: BytesN<32>) {
        owner.require_auth();
        let now = env.ledger().timestamp();
        let mut vault: Vault = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(signer.clone()))
            .ok_or(Error::VaultNotFound)
            .unwrap();
        if now < vault.expires_at {
            panic_with_error!(&env, Error::VaultStillActive);
        }
        let balance = vault.balance;
        env.storage().persistent().remove(&DataKey::Vault(signer.clone()));
        let token: Address = env.storage().instance().get(&DataKey::Token).expect("token not initialized");
        let contract_id = env.current_contract_address();
        env.invoke_contract(
            &token,
            &Symbol::short("transfer"),
            (contract_id, owner.clone(), balance).into_val(&env),
        );
    }

    pub fn get_vault(env: Env, signer: BytesN<32>) -> Option<Vault> {
        env.storage().persistent().get(&DataKey::Vault(signer))
    }

    pub fn is_redeemed(env: Env, signer: BytesN<32>, nonce: u64) -> bool {
        env.storage().persistent().has(&DataKey::Used(signer, nonce))
    }
}

fn canonical_message(env: &Env, contract_address: &Address, voucher: &Voucher) -> Bytes {
    let mut buf: Vec<u8> = Vec::new(env);
    for b in MAGIC.iter() {
        buf.push_back(*b);
    }
    let contract_xdr = contract_address.to_scval(env).to_xdr(env);
    for b in contract_xdr.iter() {
        buf.push_back(*b);
    }
    for b in voucher.signer.iter() {
        buf.push_back(*b);
    }
    let merchant_xdr = voucher.merchant.to_scval(env).to_xdr(env);
    for b in merchant_xdr.iter() {
        buf.push_back(*b);
    }
    for b in voucher.amount.to_be_bytes().iter() {
        buf.push_back(*b);
    }
    for b in voucher.nonce.to_be_bytes().iter() {
        buf.push_back(*b);
    }
    for b in voucher.expiry.to_be_bytes().iter() {
        buf.push_back(*b);
    }
    buf.into()
}

#[cfg(test)]
mod test;