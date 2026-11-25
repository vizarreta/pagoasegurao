#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    token::Client as TokenClient, xdr::ToXdr, Address, Bytes, BytesN, Env,
};

const MAGIC: &[u8; 13] = b"PAGOASEGURAO1";
const MIN_TTL_LEDGERS: u32 = 120_960; // ~7 days at ~5s per ledger
const TTL_BUFFER_LEDGERS: u32 = 17_280; // ~1 day extra beyond vault expiry

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Vault {
    pub owner: Address,        // receives remaining balance on close
    pub balance: i128,         // available funds
    pub expires_at: u64,       // unix timestamp (s); settlement window end
    pub max_per_voucher: i128, // cap per voucher
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Voucher {
    pub signer: BytesN<32>, // ed25519 public key that signed
    pub merchant: Address,  // payment recipient
    pub amount: i128,
    pub nonce: u64,  // unique per voucher
    pub expiry: u64, // unix timestamp (s); voucher expiry
}

#[contracttype]
pub enum DataKey {
    Token,
    Vault(BytesN<32>),
    Used(BytesN<32>, u64),
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum Error {
    AlreadyRedeemed = 1,
    VoucherExpired = 2,
    InvalidAmount = 3,
    InsufficientFunds = 4,
    VaultNotFound = 5,
    VaultStillActive = 6,
    VaultExists = 7,
    InvalidSignature = 8,
    Unauthorized = 9,
    InvalidExpiry = 10,
    AlreadyInitialized = 11,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Redeemed {
    #[topic]
    pub signer: BytesN<32>,
    #[topic]
    pub merchant: Address,
    pub amount: i128,
    pub nonce: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultOpened {
    #[topic]
    pub signer: BytesN<32>,
    #[topic]
    pub owner: Address,
    pub balance: i128,
    pub expires_at: u64,
    pub max_per_voucher: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultClosed {
    #[topic]
    pub signer: BytesN<32>,
    #[topic]
    pub owner: Address,
    pub refunded: i128,
}

fn compute_ttl(env: &Env, expires_at: u64) -> u32 {
    let now = env.ledger().timestamp();
    let remaining_secs = expires_at.saturating_sub(now);
    let needed_ledgers = (remaining_secs / 5).saturating_add(TTL_BUFFER_LEDGERS as u64);
    let max_ttl = env.storage().max_ttl();
    let clamped = u32::try_from(needed_ledgers).unwrap_or(max_ttl);
    clamped.max(MIN_TTL_LEDGERS).min(max_ttl)
}

fn extend_instance_ttl(env: &Env) {
    let max_ttl = env.storage().max_ttl();
    let ttl = MIN_TTL_LEDGERS.min(max_ttl);
    env.storage().instance().extend_ttl(ttl / 2, ttl);
}

#[contract]
pub struct PagoAsegurao;

#[contractimpl]
impl PagoAsegurao {
    pub fn initialize(env: Env, token: Address) {
        if env.storage().instance().has(&DataKey::Token) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Token, &token);
        extend_instance_ttl(&env);
    }

    pub fn get_token(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not initialized")
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

        if amount <= 0 || max_per_voucher <= 0 || max_per_voucher > amount {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        if expires_at <= env.ledger().timestamp() {
            panic_with_error!(&env, Error::InvalidExpiry);
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not initialized");

        let vault_key = DataKey::Vault(signer.clone());
        if env.storage().persistent().has(&vault_key) {
            panic_with_error!(&env, Error::VaultExists);
        }

        let contract_id = env.current_contract_address();
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&owner, &contract_id, &amount);

        let vault = Vault {
            owner: owner.clone(),
            balance: amount,
            expires_at,
            max_per_voucher,
        };
        let ttl = compute_ttl(&env, expires_at);
        env.storage().persistent().set(&vault_key, &vault);
        env.storage().persistent().extend_ttl(&vault_key, ttl, ttl);
        extend_instance_ttl(&env);

        VaultOpened {
            signer,
            owner,
            balance: amount,
            expires_at,
            max_per_voucher,
        }
        .publish(&env);
    }

    pub fn top_up(env: Env, owner: Address, signer: BytesN<32>, amount: i128) {
        owner.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let vault_key = DataKey::Vault(signer.clone());
        let mut vault: Vault = env
            .storage()
            .persistent()
            .get(&vault_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::VaultNotFound));

        if vault.owner != owner {
            panic_with_error!(&env, Error::Unauthorized);
        }

        if env.ledger().timestamp() >= vault.expires_at {
            panic_with_error!(&env, Error::VoucherExpired);
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not initialized");
        let contract_id = env.current_contract_address();
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&owner, &contract_id, &amount);

        vault.balance = vault
            .balance
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidAmount));

        let ttl = compute_ttl(&env, vault.expires_at);
        env.storage().persistent().set(&vault_key, &vault);
        env.storage().persistent().extend_ttl(&vault_key, ttl, ttl);
        extend_instance_ttl(&env);
    }

    pub fn redeem(env: Env, voucher: Voucher, signature: BytesN<64>) {
        let used_key = DataKey::Used(voucher.signer.clone(), voucher.nonce);

        // 1. Nonce not used
        if env.storage().persistent().has(&used_key) {
            panic_with_error!(&env, Error::AlreadyRedeemed);
        }

        // 2. Expiry checks
        let now = env.ledger().timestamp();
        if now > voucher.expiry {
            panic_with_error!(&env, Error::VoucherExpired);
        }

        let vault_key = DataKey::Vault(voucher.signer.clone());
        let vault: Vault = env
            .storage()
            .persistent()
            .get(&vault_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::VaultNotFound));

        if voucher.expiry > vault.expires_at {
            panic_with_error!(&env, Error::VoucherExpired);
        }

        // 3. Amount checks
        if voucher.amount <= 0 || voucher.amount > vault.max_per_voucher {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        // 4. Signature verification over canonical message
        let contract_id = env.current_contract_address();
        let msg = canonical_message(&env, &contract_id, &voucher);
        env.crypto()
            .ed25519_verify(&voucher.signer, &msg, &signature);

        // 5. Sufficient funds
        if vault.balance < voucher.amount {
            panic_with_error!(&env, Error::InsufficientFunds);
        }

        // 6. Effects first: mark nonce used and deduct balance
        let ttl = compute_ttl(&env, vault.expires_at);
        env.storage().persistent().set(&used_key, &true);
        env.storage().persistent().extend_ttl(&used_key, ttl, ttl);

        let mut new_vault = vault;
        new_vault.balance -= voucher.amount;
        env.storage().persistent().set(&vault_key, &new_vault);
        env.storage().persistent().extend_ttl(&vault_key, ttl, ttl);
        extend_instance_ttl(&env);

        // 7. Transfer to merchant
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not initialized");
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&contract_id, &voucher.merchant, &voucher.amount);

        // 8. Event
        Redeemed {
            signer: voucher.signer,
            merchant: voucher.merchant,
            amount: voucher.amount,
            nonce: voucher.nonce,
        }
        .publish(&env);
    }

    pub fn close_vault(env: Env, owner: Address, signer: BytesN<32>) {
        owner.require_auth();
        let now = env.ledger().timestamp();
        let vault_key = DataKey::Vault(signer.clone());
        let vault: Vault = env
            .storage()
            .persistent()
            .get(&vault_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::VaultNotFound));

        if vault.owner != owner {
            panic_with_error!(&env, Error::Unauthorized);
        }

        if now < vault.expires_at {
            panic_with_error!(&env, Error::VaultStillActive);
        }

        let balance = vault.balance;
        env.storage().persistent().remove(&vault_key);
        extend_instance_ttl(&env);

        if balance > 0 {
            let token: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .expect("token not initialized");
            let contract_id = env.current_contract_address();
            let token_client = TokenClient::new(&env, &token);
            token_client.transfer(&contract_id, &owner, &balance);
        }

        VaultClosed {
            signer,
            owner,
            refunded: balance,
        }
        .publish(&env);
    }

    pub fn get_vault(env: Env, signer: BytesN<32>) -> Option<Vault> {
        env.storage().persistent().get(&DataKey::Vault(signer))
    }

    pub fn is_redeemed(env: Env, signer: BytesN<32>, nonce: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Used(signer, nonce))
    }
}

pub fn canonical_message(env: &Env, contract_address: &Address, voucher: &Voucher) -> Bytes {
    let mut buf = Bytes::new(env);
    buf.extend_from_slice(MAGIC);
    buf.append(&contract_address.clone().to_xdr(env));
    buf.extend_from_slice(&voucher.signer.to_array());
    buf.append(&voucher.merchant.clone().to_xdr(env));
    buf.extend_from_slice(&voucher.amount.to_be_bytes());
    buf.extend_from_slice(&voucher.nonce.to_be_bytes());
    buf.extend_from_slice(&voucher.expiry.to_be_bytes());
    buf
}

#[cfg(test)]
mod test;
