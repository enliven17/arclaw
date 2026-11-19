use anchor_lang::prelude::*;

pub const CARDS_PER_BOX: usize = 3;
pub const MAX_OUTCOMES: usize = 12;
/// Machine ids are 1..=MAX_MACHINES (Single, Stack, Vault, and one spare).
pub const MAX_MACHINES: usize = 4;
pub const MAX_BOXES_PER_PLAY: u32 = 20;

/// Claw travel bounds, in cabinet units (the client maps them onto its 3D scene).
pub const CLAW_MIN: i16 = -1000;
pub const CLAW_MAX: i16 = 1000;
/// A step per move instruction, so a joystick tick never teleports the claw.
pub const MAX_STEP: i16 = 120;
/// A requested draw that has not landed after this long can be voided (the box comes back).
pub const VRF_TIMEOUT_S: i64 = 120;

pub const CONFIG_SEED: &[u8] = b"config";
pub const MACHINE_SEED: &[u8] = b"machine";
pub const PLAYER_SEED: &[u8] = b"player";
pub const ROUND_SEED: &[u8] = b"round";
pub const LINK_SEED: &[u8] = b"link";

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Hot key of the keeper: may reprice tables, never move funds.
    pub operator: Pubkey,
    pub usdc_mint: Pubkey,
    pub paused: bool,
    /// Price paid for every box sold and not yet settled. Never withdrawable.
    pub sealed_reserve: u64,
    /// Refunds the treasury could not pay at settle time; players claim them later.
    pub owed_total: u64,
    /// Tables older than this cannot start a round (0 = no limit).
    pub max_table_age: i64,
    pub rounds: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug, PartialEq)]
pub struct Card {
    pub mint: Pubkey,
    /// Base units of the stock token.
    pub amount: u64,
    /// USDC (6 dp) the card was worth when the table was set; the refund if the vault is short.
    pub value: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, InitSpace, Debug)]
pub struct Outcome {
    pub weight: u32,
    pub tier: u8,
    /// Sum of the card values.
    pub value: u64,
    pub cards: [Card; CARDS_PER_BOX],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OutcomeInput {
    pub weight: u32,
    pub tier: u8,
    pub cards: [Card; CARDS_PER_BOX],
}

#[account]
#[derive(InitSpace)]
pub struct Machine {
    pub id: u8,
    /// USDC 6 dp per box. Immutable once set: sold boxes are reserved at this price.
    pub price: u64,
    pub floor_bps: u16,
    pub cap_bps: u32,
    pub rtp_min_bps: u16,
    pub rtp_max_bps: u16,
    pub active: bool,
    /// Bumped on every new table; a round drawn against an older table is void and its box comes back.
    pub table_id: u32,
    pub priced_at: i64,
    pub total_weight: u64,
    pub rtp_bps: u16,
    #[max_len(MAX_OUTCOMES)]
    pub outcomes: Vec<Outcome>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Player {
    pub authority: Pubkey,
    /// Sealed boxes by machine id - 1.
    pub sealed: [u32; MAX_MACHINES],
    pub plays: u32,
    pub packs: u32,
    /// USDC 6 dp paid for boxes, and the table value of every pack settled (the leaderboard reads these).
    pub spent: u64,
    pub won: u64,
    pub owed: u64,
    pub next_round: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum RoundStatus {
    /// Paid for with a sealed box; the claw moves on the ephemeral rollup.
    Armed,
    /// The claw dropped; waiting for the VRF callback.
    Requested,
    /// The VRF chose the pack.
    Drawn,
    /// Abandoned before a draw, timed out, or drawn against a replaced table: the box comes back at settle.
    Void,
}

/// One claw round. Created on Solana, delegated to a MagicBlock ephemeral rollup for the real time claw, drawn by
/// MagicBlock VRF there, committed back and settled (cards paid) on Solana.
#[account]
#[derive(InitSpace)]
pub struct Round {
    pub player: Pubkey,
    /// Session key the browser holds: signs claw moves on the rollup so the wallet is asked only twice per round.
    pub driver: Pubkey,
    pub round_id: u64,
    pub machine_id: u8,
    pub table_id: u32,
    pub status: RoundStatus,
    pub claw_x: i16,
    pub claw_z: i16,
    pub moves: u16,
    pub started_at: i64,
    pub requested_at: i64,
    pub randomness: [u8; 32],
    pub outcome: u8,
    pub tier: u8,
    pub value: u64,
    pub cards: [Card; CARDS_PER_BOX],
    pub bump: u8,
}

/// A claim link: boxes held in escrow until whoever holds the link key names a recipient.
#[account]
#[derive(InitSpace)]
pub struct Link {
    pub sender: Pubkey,
    pub link_key: Pubkey,
    pub machine_id: u8,
    pub boxes: u32,
    pub expires_at: i64,
    pub bump: u8,
}

pub fn machine_index(id: u8) -> Option<usize> {
    let i = (id as usize).checked_sub(1)?;
    (i < MAX_MACHINES).then_some(i)
}
