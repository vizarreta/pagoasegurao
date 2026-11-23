#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error,
    token::Client as TokenClient, xdr::ToXdr, Address, Bytes, BytesN, Env, Symbol,
};

const MAGIC: &[u8; 13] = b"PAGOASEGURAO1";
const TTL_LEDGERS: u32 = 120_960; // ~7 days in ledgers (~5s per ledger)

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
        if env.storage().instance().has(&DataKey::Token) {
            panic_with_error!(&env, Error::VaultExists);
        }
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

        if env
            .storage()
            .persistent()
            .has(&DataKey::Vault(signer.clone()))
        {
            panic_with_error!(&env, Error::VaultExists);
        }

        let contract_id = env.current_contract_address();
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&owner, &contract_id, &amount);

        let vault = Vault {
            owner,
            balance: amount,
            expires_at,
            max_per_voucher,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Vault(signer.clone()), &vault);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Vault(signer), TTL_LEDGERS, TTL_LEDGERS);
    }

    pub fn top_up(env: Env, owner: Address, signer: BytesN<32>, amount: i128) {
        owner.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not initialized");
        let contract_id = env.current_contract_address();
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&owner, &contract_id, &amount);

        let mut vault: Vault = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(signer.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, Error::VaultNotFound));

        vault.balance = vault.balance.saturating_add(amount);
        env.storage()
            .persistent()
            .set(&DataKey::Vault(signer.clone()), &vault);
    }

    pub fn redeem(env: Env, voucher: Voucher, signature: BytesN<64>) {
        // 1. Nonce not used
        if env
            .storage()
            .persistent()
            .has(&DataKey::Used(voucher.signer.clone(), voucher.nonce))
        {
            panic_with_error!(&env, Error::AlreadyRedeemed);
        }

        // 2. Expiry checks
        let now = env.ledger().timestamp();
        if now > voucher.expiry {
            panic_with_error!(&env, Error::VoucherExpired);
        }
        let vault: Vault = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(voucher.signer.clone()))
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
        env.storage()
            .persistent()
            .set(&DataKey::Used(voucher.signer.clone(), voucher.nonce), &true);
        env.storage().persistent().extend_ttl(
            &DataKey::Used(voucher.signer.clone(), voucher.nonce),
            TTL_LEDGERS,
            TTL_LEDGERS,
        );

        let mut new_vault = vault;
        new_vault.balance = new_vault.balance.saturating_sub(voucher.amount);
        env.storage()
            .persistent()
            .set(&DataKey::Vault(voucher.signer.clone()), &new_vault);
        env.storage().persistent().extend_ttl(
            &DataKey::Vault(voucher.signer.clone()),
            TTL_LEDGERS,
            TTL_LEDGERS,
        );

        // 7. Transfer to merchant
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not initialized");
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&contract_id, &voucher.merchant, &voucher.amount);

        // 8. Event
        env.events().publish(
            (
                Symbol::new(&env, "redeemed"),
                voucher.signer.clone(),
                voucher.merchant.clone(),
            ),
            (voucher.amount, voucher.nonce),
        );
    }

    pub fn close_vault(env: Env, owner: Address, signer: BytesN<32>) {
        owner.require_auth();
        let now = env.ledger().timestamp();
        let vault: Vault = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(signer.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, Error::VaultNotFound));

        if now < vault.expires_at {
            panic_with_error!(&env, Error::VaultStillActive);
        }

        let balance = vault.balance;
        env.storage()
            .persistent()
            .remove(&DataKey::Vault(signer.clone()));

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
