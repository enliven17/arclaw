//! arclaw on Solana: pay USDC, play a claw machine in real time on a MagicBlock ephemeral rollup, win a sealed box
//! whose pack of three tokenized stock cards is drawn by MagicBlock VRF.
//!
//! Life of a box
//!
//!   Solana   play          USDC into the treasury, `boxes` sealed boxes on the player's account
//!   Solana   start_round   burns one sealed box into a Round PDA, names the browser's session key as driver
//!   Solana   delegate_round  hands the Round to the ephemeral rollup
//!   ER       move_claw     the claw follows the joystick, signed by the session key, no wallet prompts, no fees
//!   ER       drop_claw     asks MagicBlock VRF for one word (the ephemeral queue)
//!   ER       reveal_round  VRF callback: draws ONE weighted outcome from the machine's table (a pack of 3 cards)
//!   ER       finish_round  commits the Round back to Solana and undelegates it
//!   Solana   settle_round  pays the three cards from the vault (or refunds a short card in USDC), closes the Round
//!
//! The claw is theatre: where it drops changes nothing, the VRF decides the pack. A round that never draws (abandoned,
//! timed out, or drawn against a table replaced in the meantime) is void and its box goes back to the player.
//!
//! Treasury rules carried over from the Arc contract: every table obeys the machine's floor, cap and RTP band; the
//! price of every unsettled box is reserved and cannot be withdrawn; a card the vault cannot cover is refunded at its
//! table value, from free USDC, or recorded as owed.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::{get_associated_token_address_with_program_id, AssociatedToken};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use ephemeral_rollups_sdk::vrf as vrf_sdk;
use ephemeral_rollups_sdk::anchor::{vrf, vrf_callback};

pub mod errors;
pub mod rules;
pub mod state;

use errors::ArclawError;
use state::*;

declare_id!("DJMcHeBR4sSN2e7kx56fennhEdQpbAV7nmxLTAYS7WeW");

const SLOT_HASHES_ID: Pubkey = pubkey!("SysvarS1otHashes111111111111111111111111111");
const PROGRAM_IDENTITY: Pubkey = vrf_sdk::consts::program_identity_pubkey(&crate::ID);

#[ephemeral]
#[program]
pub mod arclaw {
    use super::*;

    // ------------------------------------------------------------------ admin

    pub fn initialize(ctx: Context<Initialize>, operator: Pubkey, max_table_age: i64) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.operator = operator;
        c.usdc_mint = ctx.accounts.usdc_mint.key();
        c.paused = false;
        c.sealed_reserve = 0;
        c.owed_total = 0;
        c.max_table_age = max_table_age;
        c.rounds = 0;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_admin(ctx: Context<AdminOnly>, admin: Pubkey, operator: Pubkey, paused: bool, max_table_age: i64) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = admin;
        c.operator = operator;
        c.paused = paused;
        c.max_table_age = max_table_age;
        emit!(AdminSet { admin, operator, paused, max_table_age });
        Ok(())
    }

    /// Creates or updates a machine's rules. The price is fixed after the first call.
    #[allow(clippy::too_many_arguments)]
    pub fn set_machine(
        ctx: Context<SetMachine>,
        id: u8,
        price: u64,
        floor_bps: u16,
        cap_bps: u32,
        rtp_min_bps: u16,
        rtp_max_bps: u16,
        active: bool,
    ) -> Result<()> {
        machine_index(id).ok_or(ArclawError::UnknownMachine)?;
        let r = rules::MachineRules { price, floor_bps, cap_bps, rtp_min_bps, rtp_max_bps };
        r.check().map_err(|_| ArclawError::BadMachine)?;
        let m = &mut ctx.accounts.machine;
        if m.price != 0 && m.price != price {
            return err!(ArclawError::PriceImmutable);
        }
        let rules_changed = m.floor_bps != floor_bps || m.cap_bps != cap_bps || m.rtp_min_bps != rtp_min_bps || m.rtp_max_bps != rtp_max_bps;
        m.id = id;
        m.price = price;
        m.floor_bps = floor_bps;
        m.cap_bps = cap_bps;
        m.rtp_min_bps = rtp_min_bps;
        m.rtp_max_bps = rtp_max_bps;
        m.active = active;
        m.bump = ctx.bumps.machine;
        // A table set under other rules must be set again under these.
        if rules_changed && !m.outcomes.is_empty() {
            m.outcomes.clear();
            m.total_weight = 0;
            m.table_id = m.table_id.wrapping_add(1);
        }
        emit!(MachineSet { id, price, floor_bps, cap_bps, rtp_min_bps, rtp_max_bps, active });
        Ok(())
    }

    /// Replaces a machine's outcome table. Admin or operator; either way the machine's rules are enforced.
    pub fn set_table(ctx: Context<SetTable>, _id: u8, input: Vec<OutcomeInput>) -> Result<()> {
        let config = &ctx.accounts.config;
        let signer = ctx.accounts.authority.key();
        require!(signer == config.admin || signer == config.operator, ArclawError::NotOperator);
        require!(!input.is_empty(), ArclawError::NoPrizes);
        require!(input.len() <= MAX_OUTCOMES, ArclawError::TooManyOutcomes);

        let m = &mut ctx.accounts.machine;
        let mut outcomes = Vec::with_capacity(input.len());
        for o in input.iter() {
            let mut value: u64 = 0;
            for c in o.cards.iter() {
                require!(c.mint != Pubkey::default() && c.amount > 0 && c.mint != config.usdc_mint, ArclawError::BadPrize);
                value = value.checked_add(c.value).ok_or(ArclawError::Overflow)?;
            }
            outcomes.push(Outcome { weight: o.weight, tier: o.tier, value, cards: o.cards });
        }
        let r = rules::MachineRules { price: m.price, floor_bps: m.floor_bps, cap_bps: m.cap_bps, rtp_min_bps: m.rtp_min_bps, rtp_max_bps: m.rtp_max_bps };
        let pairs: Vec<(u32, u64)> = outcomes.iter().map(|o| (o.weight, o.value)).collect();
        let rtp = rules::validate(&r, &pairs).map_err(|e| match e {
            rules::RuleError::NoOutcomes => ArclawError::NoPrizes,
            rules::RuleError::ZeroWeight(_) => ArclawError::BadPrize,
            rules::RuleError::BelowFloor(_) => ArclawError::BelowFloor,
            rules::RuleError::AboveCap(_) => ArclawError::AboveCap,
            rules::RuleError::RtpOutOfBand(_) => ArclawError::RtpOutOfBand,
            rules::RuleError::BadMachine => ArclawError::BadMachine,
        })?;

        m.total_weight = pairs.iter().map(|p| p.0 as u64).sum();
        m.outcomes = outcomes;
        m.table_id = m.table_id.wrapping_add(1);
        m.priced_at = Clock::get()?.unix_timestamp;
        m.rtp_bps = rtp as u16;
        emit!(TableSet { machine_id: m.id, table_id: m.table_id, count: m.outcomes.len() as u8, rtp_bps: m.rtp_bps, by: signer });
        Ok(())
    }

    /// Takes free USDC out of the treasury: never the reserve of unsettled boxes, never what is owed.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let c = &ctx.accounts.config;
        let locked = c.sealed_reserve.checked_add(c.owed_total).ok_or(ArclawError::Overflow)?;
        let free = ctx.accounts.treasury.amount.saturating_sub(locked);
        require!(amount <= free, ArclawError::Reserved);
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[c.bump]];
        transfer_from_pda(
            &ctx.accounts.token_program,
            &ctx.accounts.treasury.to_account_info(),
            &ctx.accounts.usdc_mint.to_account_info(),
            &ctx.accounts.to.to_account_info(),
            &ctx.accounts.config.to_account_info(),
            amount,
            ctx.accounts.usdc_mint.decimals,
            seeds,
        )
    }

    /// Moves prize stock out of the vault (rebalancing, retiring a stock). Stock is not reserved: see the trust note in
    /// docs/SOLANA.md.
    pub fn sweep(ctx: Context<Sweep>, amount: u64) -> Result<()> {
        require!(ctx.accounts.mint.key() != ctx.accounts.config.usdc_mint, ArclawError::Reserved);
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[ctx.accounts.config.bump]];
        transfer_from_pda(
            &ctx.accounts.token_program,
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.mint.to_account_info(),
            &ctx.accounts.to.to_account_info(),
            &ctx.accounts.config.to_account_info(),
            amount,
            ctx.accounts.mint.decimals,
            seeds,
        )
    }

    // ------------------------------------------------------------------ boxes

    /// Pays `boxes * price` USDC and adds that many sealed boxes.
    pub fn play(ctx: Context<Play>, machine_id: u8, boxes: u32) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, ArclawError::Paused);
        require!(boxes > 0, ArclawError::ZeroAmount);
        require!(boxes <= MAX_BOXES_PER_PLAY, ArclawError::TooManyBoxes);
        let m = &ctx.accounts.machine;
        require!(m.active, ArclawError::MachineOff);
        require!(!m.outcomes.is_empty(), ArclawError::NoPrizes);
        let idx = machine_index(machine_id).ok_or(ArclawError::UnknownMachine)?;
        let cost = m.price.checked_mul(boxes as u64).ok_or(ArclawError::Overflow)?;

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.payer_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            cost,
            ctx.accounts.usdc_mint.decimals,
        )?;
        config.sealed_reserve = config.sealed_reserve.checked_add(cost).ok_or(ArclawError::Overflow)?;

        let p = &mut ctx.accounts.player;
        init_player(p, ctx.accounts.payer.key(), ctx.bumps.player);
        p.sealed[idx] = p.sealed[idx].checked_add(boxes).ok_or(ArclawError::Overflow)?;
        p.plays = p.plays.saturating_add(boxes);
        p.spent = p.spent.saturating_add(cost);
        emit!(Played { player: p.authority, machine_id, boxes, paid: cost });
        Ok(())
    }

    /// Sends sealed boxes to any wallet.
    pub fn gift(ctx: Context<Gift>, machine_id: u8, boxes: u32) -> Result<()> {
        let idx = machine_index(machine_id).ok_or(ArclawError::UnknownMachine)?;
        require!(boxes > 0, ArclawError::ZeroAmount);
        let from = &mut ctx.accounts.sender_state;
        from.sealed[idx] = from.sealed[idx].checked_sub(boxes).ok_or(ArclawError::NoBoxes)?;
        let to = &mut ctx.accounts.recipient_state;
        init_player(to, ctx.accounts.recipient.key(), ctx.bumps.recipient_state);
        to.sealed[idx] = to.sealed[idx].checked_add(boxes).ok_or(ArclawError::Overflow)?;
        emit!(Gifted { from: ctx.accounts.sender.key(), to: ctx.accounts.recipient.key(), machine_id, boxes });
        Ok(())
    }

    /// Escrows boxes behind a fresh link key. The link (a URL holding the key) is the gift: whoever opens it names
    /// themselves as recipient in a transaction the link key co-signs, so nobody can redirect the boxes in flight.
    pub fn create_link(ctx: Context<CreateLink>, link_key: Pubkey, machine_id: u8, boxes: u32, expires_at: i64) -> Result<()> {
        let idx = machine_index(machine_id).ok_or(ArclawError::UnknownMachine)?;
        require!(boxes > 0, ArclawError::ZeroAmount);
        require!(expires_at > Clock::get()?.unix_timestamp, ArclawError::LinkExpired);
        let from = &mut ctx.accounts.sender_state;
        from.sealed[idx] = from.sealed[idx].checked_sub(boxes).ok_or(ArclawError::NoBoxes)?;
        let l = &mut ctx.accounts.link;
        l.sender = ctx.accounts.sender.key();
        l.link_key = link_key;
        l.machine_id = machine_id;
        l.boxes = boxes;
        l.expires_at = expires_at;
        l.bump = ctx.bumps.link;
        emit!(LinkCreated { link_key, sender: l.sender, machine_id, boxes, expires_at });
        Ok(())
    }

    pub fn claim_link(ctx: Context<ClaimLink>) -> Result<()> {
        let l = &ctx.accounts.link;
        require!(Clock::get()?.unix_timestamp <= l.expires_at, ArclawError::LinkExpired);
        let idx = machine_index(l.machine_id).ok_or(ArclawError::UnknownMachine)?;
        let to = &mut ctx.accounts.recipient_state;
        init_player(to, ctx.accounts.recipient.key(), ctx.bumps.recipient_state);
        to.sealed[idx] = to.sealed[idx].checked_add(l.boxes).ok_or(ArclawError::Overflow)?;
        emit!(LinkClaimed { link_key: l.link_key, recipient: to.authority, machine_id: l.machine_id, boxes: l.boxes });
        Ok(())
    }

    pub fn reclaim_link(ctx: Context<ReclaimLink>) -> Result<()> {
        let l = &ctx.accounts.link;
        require!(Clock::get()?.unix_timestamp > l.expires_at, ArclawError::LinkLive);
        let idx = machine_index(l.machine_id).ok_or(ArclawError::UnknownMachine)?;
        let s = &mut ctx.accounts.sender_state;
        s.sealed[idx] = s.sealed[idx].checked_add(l.boxes).ok_or(ArclawError::Overflow)?;
        emit!(LinkClaimed { link_key: l.link_key, recipient: s.authority, machine_id: l.machine_id, boxes: l.boxes });
        Ok(())
    }

    // ------------------------------------------------------------------ a round

    /// Burns one sealed box into a Round the browser's session key drives.
    pub fn start_round(ctx: Context<StartRound>, machine_id: u8, driver: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, ArclawError::Paused);
        let m = &ctx.accounts.machine;
        require!(m.active, ArclawError::MachineOff);
        require!(!m.outcomes.is_empty(), ArclawError::NoPrizes);
        let now = Clock::get()?.unix_timestamp;
        if config.max_table_age > 0 {
            require!(now - m.priced_at <= config.max_table_age, ArclawError::TableStale);
        }
        let idx = machine_index(machine_id).ok_or(ArclawError::UnknownMachine)?;
        let p = &mut ctx.accounts.player_state;
        p.sealed[idx] = p.sealed[idx].checked_sub(1).ok_or(ArclawError::NoBoxes)?;
        let round_id = p.next_round;
        p.next_round += 1;
        config.rounds += 1;

        let r = &mut ctx.accounts.round;
        r.player = ctx.accounts.player.key();
        r.driver = driver;
        r.round_id = round_id;
        r.machine_id = machine_id;
        r.table_id = m.table_id;
        r.status = RoundStatus::Armed;
        r.claw_x = 0;
        r.claw_z = 0;
        r.moves = 0;
        r.started_at = now;
        r.requested_at = 0;
        r.randomness = [0; 32];
        r.outcome = 0;
        r.tier = 0;
        r.value = 0;
        r.cards = [Card::default(); CARDS_PER_BOX];
        r.bump = ctx.bumps.round;
        emit!(RoundStarted { player: r.player, round_id, machine_id, table_id: r.table_id, driver });
        Ok(())
    }

    /// Hands the Round to the ephemeral rollup. `validator` picks the ER region; None takes the default.
    pub fn delegate_round(ctx: Context<DelegateRound>, round_id: u64, validator: Option<Pubkey>) -> Result<()> {
        let player = ctx.accounts.payer.key();
        let id = round_id.to_le_bytes();
        ctx.accounts.delegate_round(
            &ctx.accounts.payer,
            &[ROUND_SEED, player.as_ref(), &id],
            DelegateConfig { validator, ..Default::default() },
        )?;
        Ok(())
    }

    /// One joystick step (ER). Clamped to the cabinet and to MAX_STEP per call.
    pub fn move_claw(ctx: Context<Drive>, dx: i16, dz: i16) -> Result<()> {
        let r = &mut ctx.accounts.round;
        require!(r.status == RoundStatus::Armed, ArclawError::BadRoundState);
        let dx = dx.clamp(-MAX_STEP, MAX_STEP);
        let dz = dz.clamp(-MAX_STEP, MAX_STEP);
        r.claw_x = r.claw_x.saturating_add(dx).clamp(CLAW_MIN, CLAW_MAX);
        r.claw_z = r.claw_z.saturating_add(dz).clamp(CLAW_MIN, CLAW_MAX);
        r.moves = r.moves.saturating_add(1);
        Ok(())
    }

    /// Drops the claw (ER, or Solana if the round was never delegated): asks MagicBlock VRF for the word.
    pub fn drop_claw(ctx: Context<DropClaw>, client_seed: [u8; 32]) -> Result<()> {
        let q = ctx.accounts.oracle_queue.key();
        require!(q == vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE || q == vrf_sdk::consts::DEFAULT_QUEUE, ArclawError::BadQueue);
        let r = &mut ctx.accounts.round;
        require!(r.status == RoundStatus::Armed, ArclawError::BadRoundState);
        require!(ctx.accounts.payer.key() == r.driver, ArclawError::NotDriver);
        r.status = RoundStatus::Requested;
        r.requested_at = Clock::get()?.unix_timestamp;

        // Seed: the player's, the round and where the claw dropped. It cannot steer the word (the oracle's VRF does),
        // it only makes every request distinct.
        let mut seed = client_seed;
        let mix = [r.player.as_ref(), &r.round_id.to_le_bytes(), &r.claw_x.to_le_bytes(), &r.claw_z.to_le_bytes()].concat();
        for (i, b) in mix.iter().enumerate() {
            seed[i % 32] ^= b;
        }
        let ix = vrf_sdk::instructions::create_request_randomness_ix_const(
            vrf_sdk::instructions::RequestRandomnessParams {
                payer: ctx.accounts.payer.key(),
                oracle_queue: q,
                callback_program_id: crate::ID,
                callback_discriminator: instruction::RevealRound::DISCRIMINATOR.to_vec(),
                caller_seed: seed,
                accounts_metas: Some(vec![
                    vrf_sdk::types::SerializableAccountMeta { pubkey: r.key(), is_signer: false, is_writable: true },
                    vrf_sdk::types::SerializableAccountMeta { pubkey: ctx.accounts.machine.key(), is_signer: false, is_writable: false },
                ]),
                ..Default::default()
            },
            PROGRAM_IDENTITY,
        );
        let ev = ClawDropped { player: r.player, round_id: r.round_id, claw_x: r.claw_x, claw_z: r.claw_z };
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        emit!(ev);
        Ok(())
    }

    /// VRF callback: one weighted draw from the table the round started on.
    pub fn reveal_round(ctx: Context<RevealRound>, randomness: [u8; 32]) -> Result<()> {
        let r = &mut ctx.accounts.round;
        require!(r.status == RoundStatus::Requested, ArclawError::BadRoundState);
        let m = &ctx.accounts.machine;
        r.randomness = randomness;
        if m.table_id != r.table_id || m.outcomes.is_empty() {
            r.status = RoundStatus::Void;
            return Ok(());
        }
        let roll = rules::roll(&randomness, m.total_weight);
        let i = rules::pick(m.outcomes.iter().map(|o| o.weight), roll);
        let o = &m.outcomes[i];
        r.outcome = i as u8;
        r.tier = o.tier;
        r.value = o.value;
        r.cards = o.cards;
        r.status = RoundStatus::Drawn;
        emit!(RoundDrawn { player: r.player, round_id: r.round_id, machine_id: r.machine_id, tier: r.tier, value: r.value });
        Ok(())
    }

    /// Ends the round on the rollup and sends it back to Solana. The driver (or the player) may end an Armed round (the box comes
    /// back) and a draw that never landed after VRF_TIMEOUT_S; anyone may send home a Drawn or Void round, so a
    /// keeper can finish what a closed tab left behind.
    pub fn finish_round(ctx: Context<FinishRound>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        // The player may stand in for the driver: a closed tab loses the session key, never the box.
        let payer = ctx.accounts.payer.key();
        let is_driver = payer == ctx.accounts.round.driver || payer == ctx.accounts.round.player;
        {
            let r = &mut ctx.accounts.round;
            match r.status {
                RoundStatus::Drawn | RoundStatus::Void => {}
                RoundStatus::Armed => {
                    require!(is_driver, ArclawError::NotDriver);
                    r.status = RoundStatus::Void;
                }
                RoundStatus::Requested => {
                    require!(now > r.requested_at + VRF_TIMEOUT_S, ArclawError::NotExpired);
                    r.status = RoundStatus::Void;
                }
            }
            r.exit(&crate::ID)?;
        }
        commit_and_undelegate_accounts(
            &ctx.accounts.payer.to_account_info(),
            vec![&ctx.accounts.round.to_account_info()],
            &ctx.accounts.magic_context.to_account_info(),
            &ctx.accounts.magic_program.to_account_info(),
            None,
        )?;
        Ok(())
    }

    /// Same as finish_round for a round that was never delegated (the Solana-only fallback): marks it Void if it
    /// may be, so settle_round can return the box.
    pub fn void_round(ctx: Context<VoidRound>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let r = &mut ctx.accounts.round;
        match r.status {
            RoundStatus::Armed => require!(ctx.accounts.signer.key() == r.driver || ctx.accounts.signer.key() == r.player, ArclawError::NotDriver),
            RoundStatus::Requested => require!(now > r.requested_at + VRF_TIMEOUT_S, ArclawError::NotExpired),
            _ => return err!(ArclawError::BadRoundState),
        }
        r.status = RoundStatus::Void;
        Ok(())
    }

    /// Pays the pack (Solana). Remaining accounts, four per card in order: mint, vault ATA (config's), player ATA,
    /// token program. A card the vault cannot cover is refunded at its table value in USDC, or owed if the treasury
    /// has no free USDC. A void round returns its box. Anyone may settle; the cards and the rent go to the player.
    pub fn settle_round<'info>(ctx: Context<'info, SettleRound<'info>>) -> Result<()> {
        let r = &ctx.accounts.round;
        let idx = machine_index(r.machine_id).ok_or(ArclawError::UnknownMachine)?;
        let price = ctx.accounts.machine.price;

        if r.status == RoundStatus::Void {
            let p = &mut ctx.accounts.player_state;
            p.sealed[idx] = p.sealed[idx].checked_add(1).ok_or(ArclawError::Overflow)?;
            emit!(RoundSettled { player: r.player, round_id: r.round_id, machine_id: r.machine_id, void: true, tier: 0, value: 0, refund: 0, cards: r.cards, paid: [false; 3] });
            return Ok(());
        }
        require!(r.status == RoundStatus::Drawn, ArclawError::BadRoundState);
        require!(ctx.remaining_accounts.len() == 4 * CARDS_PER_BOX, ArclawError::BadCardAccounts);

        // The box is settled: its price leaves the reserve and becomes free revenue, out of which refunds are paid.
        let config_bump = ctx.accounts.config.bump;
        ctx.accounts.config.sealed_reserve = ctx.accounts.config.sealed_reserve.saturating_sub(price);
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[config_bump]];
        let config_key = ctx.accounts.config.key();
        let player_key = ctx.accounts.player.key();

        let mut refund: u64 = 0;
        let mut paid = [false; CARDS_PER_BOX];
        for (i, card) in r.cards.iter().enumerate() {
            let a = &ctx.remaining_accounts[4 * i..4 * i + 4];
            let (mint_ai, vault_ai, dest_ai, prog_ai) = (&a[0], &a[1], &a[2], &a[3]);
            require!(mint_ai.key() == card.mint, ArclawError::BadCardAccounts);
            require!(
                prog_ai.key() == anchor_spl::token::ID || prog_ai.key() == anchor_spl::token_2022::ID,
                ArclawError::BadCardAccounts
            );
            require!(vault_ai.key() == get_associated_token_address_with_program_id(&config_key, &card.mint, &prog_ai.key()), ArclawError::BadCardAccounts);
            require!(dest_ai.key() == get_associated_token_address_with_program_id(&player_key, &card.mint, &prog_ai.key()), ArclawError::BadCardAccounts);
            let mint = InterfaceAccount::<Mint>::try_from(mint_ai)?;
            let have = InterfaceAccount::<TokenAccount>::try_from(vault_ai).map(|v| v.amount).unwrap_or(0);
            if have >= card.amount {
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        prog_ai.key(),
                        TransferChecked { from: vault_ai.clone(), mint: mint_ai.clone(), to: dest_ai.clone(), authority: ctx.accounts.config.to_account_info() },
                        &[seeds],
                    ),
                    card.amount,
                    mint.decimals,
                )?;
                paid[i] = true;
            } else {
                refund = refund.checked_add(card.value).ok_or(ArclawError::Overflow)?;
            }
        }

        let mut owed = 0;
        if refund > 0 {
            let c = &ctx.accounts.config;
            let locked = c.sealed_reserve.saturating_add(c.owed_total);
            let free = ctx.accounts.treasury.amount.saturating_sub(locked);
            if free >= refund {
                transfer_from_pda(
                    &ctx.accounts.token_program,
                    &ctx.accounts.treasury.to_account_info(),
                    &ctx.accounts.usdc_mint.to_account_info(),
                    &ctx.accounts.player_usdc.to_account_info(),
                    &ctx.accounts.config.to_account_info(),
                    refund,
                    ctx.accounts.usdc_mint.decimals,
                    seeds,
                )?;
            } else {
                owed = refund;
                ctx.accounts.config.owed_total = ctx.accounts.config.owed_total.saturating_add(refund);
            }
        }

        let p = &mut ctx.accounts.player_state;
        p.packs = p.packs.saturating_add(1);
        p.won = p.won.saturating_add(r.value);
        p.owed = p.owed.saturating_add(owed);
        emit!(RoundSettled { player: r.player, round_id: r.round_id, machine_id: r.machine_id, void: false, tier: r.tier, value: r.value, refund, cards: r.cards, paid });
        Ok(())
    }

    /// Pays what a short treasury owed, once it can.
    pub fn claim_owed(ctx: Context<ClaimOwed>) -> Result<()> {
        let owed = ctx.accounts.player_state.owed;
        require!(owed > 0, ArclawError::NothingOwed);
        let c = &ctx.accounts.config;
        // The owed amounts are what is locked for this: only the reserve of sealed boxes comes first.
        let available = ctx.accounts.treasury.amount.saturating_sub(c.sealed_reserve);
        let pay = owed.min(available);
        require!(pay > 0, ArclawError::Reserved);
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[c.bump]];
        transfer_from_pda(
            &ctx.accounts.token_program,
            &ctx.accounts.treasury.to_account_info(),
            &ctx.accounts.usdc_mint.to_account_info(),
            &ctx.accounts.player_usdc.to_account_info(),
            &ctx.accounts.config.to_account_info(),
            pay,
            ctx.accounts.usdc_mint.decimals,
            seeds,
        )?;
        ctx.accounts.player_state.owed -= pay;
        ctx.accounts.config.owed_total = ctx.accounts.config.owed_total.saturating_sub(pay);
        Ok(())
    }
}

// ------------------------------------------------------------------ helpers

fn init_player(p: &mut Account<Player>, authority: Pubkey, bump: u8) {
    if p.authority == Pubkey::default() {
        p.authority = authority;
        p.bump = bump;
    }
}

#[allow(clippy::too_many_arguments)]
fn transfer_from_pda<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    seeds: &[&[u8]],
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked { from: from.clone(), mint: mint.clone(), to: to.clone(), authority: authority.clone() },
            &[seeds],
        ),
        amount,
        decimals,
    )
}

// ------------------------------------------------------------------ accounts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init, payer = admin,
        associated_token::mint = usdc_mint, associated_token::authority = config, associated_token::token_program = token_program
    )]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(id: u8)]
pub struct SetMachine<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(init_if_needed, payer = admin, space = 8 + Machine::INIT_SPACE, seeds = [MACHINE_SEED, &[id]], bump)]
    pub machine: Account<'info, Machine>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u8)]
pub struct SetTable<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [MACHINE_SEED, &[id]], bump = machine.bump)]
    pub machine: Account<'info, Machine>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin, has_one = usdc_mint)]
    pub config: Account<'info, Config>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = config, associated_token::token_program = token_program)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, token::token_program = token_program)]
    pub to: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Sweep<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = config, associated_token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub to: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(machine_id: u8)]
pub struct Play<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Account<'info, Config>,
    #[account(seeds = [MACHINE_SEED, &[machine_id]], bump = machine.bump)]
    pub machine: Account<'info, Machine>,
    #[account(init_if_needed, payer = payer, space = 8 + Player::INIT_SPACE, seeds = [PLAYER_SEED, payer.key().as_ref()], bump)]
    pub player: Account<'info, Player>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = usdc_mint, token::authority = payer, token::token_program = token_program)]
    pub payer_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = config, associated_token::token_program = token_program)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Gift<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    #[account(mut, seeds = [PLAYER_SEED, sender.key().as_ref()], bump = sender_state.bump)]
    pub sender_state: Account<'info, Player>,
    /// CHECK: any wallet; only its key is used.
    pub recipient: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = sender, space = 8 + Player::INIT_SPACE, seeds = [PLAYER_SEED, recipient.key().as_ref()], bump)]
    pub recipient_state: Account<'info, Player>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(link_key: Pubkey)]
pub struct CreateLink<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    #[account(mut, seeds = [PLAYER_SEED, sender.key().as_ref()], bump = sender_state.bump)]
    pub sender_state: Account<'info, Player>,
    #[account(init, payer = sender, space = 8 + Link::INIT_SPACE, seeds = [LINK_SEED, link_key.as_ref()], bump)]
    pub link: Account<'info, Link>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimLink<'info> {
    /// The recipient names and pays for themselves; the link key co-signs, so the recipient cannot be swapped.
    #[account(mut)]
    pub recipient: Signer<'info>,
    pub link_key: Signer<'info>,
    #[account(mut, seeds = [LINK_SEED, link_key.key().as_ref()], bump = link.bump, has_one = link_key, has_one = sender, close = sender)]
    pub link: Account<'info, Link>,
    /// CHECK: receives the link's rent back; checked by has_one.
    #[account(mut)]
    pub sender: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = recipient, space = 8 + Player::INIT_SPACE, seeds = [PLAYER_SEED, recipient.key().as_ref()], bump)]
    pub recipient_state: Account<'info, Player>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReclaimLink<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    #[account(mut, seeds = [LINK_SEED, link.link_key.as_ref()], bump = link.bump, has_one = sender, close = sender)]
    pub link: Account<'info, Link>,
    #[account(mut, seeds = [PLAYER_SEED, sender.key().as_ref()], bump = sender_state.bump)]
    pub sender_state: Account<'info, Player>,
}

#[derive(Accounts)]
#[instruction(machine_id: u8)]
pub struct StartRound<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [MACHINE_SEED, &[machine_id]], bump = machine.bump)]
    pub machine: Account<'info, Machine>,
    #[account(mut, seeds = [PLAYER_SEED, player.key().as_ref()], bump = player_state.bump)]
    pub player_state: Account<'info, Player>,
    #[account(
        init, payer = player, space = 8 + Round::INIT_SPACE,
        seeds = [ROUND_SEED, player.key().as_ref(), &player_state.next_round.to_le_bytes()], bump
    )]
    pub round: Account<'info, Round>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct DelegateRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the player's Round PDA, delegated to the ER.
    #[account(mut, del, seeds = [ROUND_SEED, payer.key().as_ref(), &round_id.to_le_bytes()], bump)]
    pub round: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Drive<'info> {
    pub driver: Signer<'info>,
    #[account(mut, has_one = driver @ ArclawError::NotDriver)]
    pub round: Account<'info, Round>,
}

#[vrf]
#[derive(Accounts)]
pub struct DropClaw<'info> {
    /// The round's driver: pays the request on the rollup.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROUND_SEED, round.player.as_ref(), &round.round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(seeds = [MACHINE_SEED, &[round.machine_id]], bump = machine.bump)]
    pub machine: Account<'info, Machine>,
    /// CHECK: one of MagicBlock's queues, checked in the handler.
    #[account(mut)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: the SlotHashes sysvar (declared here: Anchor 1.x no longer re-exports the path the macro uses).
    #[account(address = SLOT_HASHES_ID)]
    pub slot_hashes: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct RevealRound<'info> {
    #[account(mut, seeds = [ROUND_SEED, round.player.as_ref(), &round.round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(seeds = [MACHINE_SEED, &[round.machine_id]], bump = machine.bump)]
    pub machine: Account<'info, Machine>,
}

#[commit]
#[derive(Accounts)]
pub struct FinishRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROUND_SEED, round.player.as_ref(), &round.round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
pub struct VoidRound<'info> {
    pub signer: Signer<'info>,
    #[account(mut, seeds = [ROUND_SEED, round.player.as_ref(), &round.round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
pub struct SettleRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the round's player; receives the cards, any refund and the round's rent.
    #[account(mut, address = round.player)]
    pub player: UncheckedAccount<'info>,
    #[account(mut, seeds = [PLAYER_SEED, round.player.as_ref()], bump = player_state.bump)]
    pub player_state: Box<Account<'info, Player>>,
    #[account(mut, seeds = [ROUND_SEED, round.player.as_ref(), &round.round_id.to_le_bytes()], bump = round.bump, close = player)]
    pub round: Box<Account<'info, Round>>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [MACHINE_SEED, &[round.machine_id]], bump = machine.bump)]
    pub machine: Box<Account<'info, Machine>>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = config, associated_token::token_program = token_program)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed, payer = payer,
        associated_token::mint = usdc_mint, associated_token::authority = player, associated_token::token_program = token_program
    )]
    pub player_usdc: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimOwed<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [PLAYER_SEED, player.key().as_ref()], bump = player_state.bump)]
    pub player_state: Account<'info, Player>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Account<'info, Config>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = config, associated_token::token_program = token_program)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = player, associated_token::token_program = token_program)]
    pub player_usdc: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

// ------------------------------------------------------------------ events (the Convex indexer reads these)

#[event]
pub struct AdminSet {
    pub admin: Pubkey,
    pub operator: Pubkey,
    pub paused: bool,
    pub max_table_age: i64,
}

#[event]
pub struct MachineSet {
    pub id: u8,
    pub price: u64,
    pub floor_bps: u16,
    pub cap_bps: u32,
    pub rtp_min_bps: u16,
    pub rtp_max_bps: u16,
    pub active: bool,
}

#[event]
pub struct TableSet {
    pub machine_id: u8,
    pub table_id: u32,
    pub count: u8,
    pub rtp_bps: u16,
    pub by: Pubkey,
}

#[event]
pub struct Played {
    pub player: Pubkey,
    pub machine_id: u8,
    pub boxes: u32,
    pub paid: u64,
}

#[event]
pub struct Gifted {
    pub from: Pubkey,
    pub to: Pubkey,
    pub machine_id: u8,
    pub boxes: u32,
}

#[event]
pub struct LinkCreated {
    pub link_key: Pubkey,
    pub sender: Pubkey,
    pub machine_id: u8,
    pub boxes: u32,
    pub expires_at: i64,
}

#[event]
pub struct LinkClaimed {
    pub link_key: Pubkey,
    pub recipient: Pubkey,
    pub machine_id: u8,
    pub boxes: u32,
}

#[event]
pub struct RoundStarted {
    pub player: Pubkey,
    pub round_id: u64,
    pub machine_id: u8,
    pub table_id: u32,
    pub driver: Pubkey,
}

#[event]
pub struct ClawDropped {
    pub player: Pubkey,
    pub round_id: u64,
    pub claw_x: i16,
    pub claw_z: i16,
}

#[event]
pub struct RoundDrawn {
    pub player: Pubkey,
    pub round_id: u64,
    pub machine_id: u8,
    pub tier: u8,
    pub value: u64,
}

#[event]
pub struct RoundSettled {
    pub player: Pubkey,
    pub round_id: u64,
    pub machine_id: u8,
    pub void: bool,
    pub tier: u8,
    pub value: u64,
    pub refund: u64,
    pub cards: [Card; CARDS_PER_BOX],
    pub paid: [bool; CARDS_PER_BOX],
}
