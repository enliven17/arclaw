//! Pure table rules and the weighted draw. No Anchor types here, so they are unit tested on the host.
//!
//! On-chain prize table rules:
//!   floor  every outcome is worth at least floor_bps of the play price,
//!   cap    no outcome is worth more than cap_bps of the price,
//!   rtp    the weighted expected value sits inside [rtp_min_bps, rtp_max_bps] of the price.

pub const BPS: u128 = 10_000;
/// Never less than half back: the product promise.
pub const MIN_FLOOR_BPS: u16 = 5_000;
/// House edge never under 5%.
pub const MAX_RTP_BPS: u16 = 9_500;
/// 100x.
pub const MAX_CAP_BPS: u32 = 1_000_000;

#[derive(Debug, PartialEq, Eq)]
pub enum RuleError {
    NoOutcomes,
    ZeroWeight(usize),
    BelowFloor(usize),
    AboveCap(usize),
    RtpOutOfBand(u64),
    BadMachine,
}

#[derive(Clone, Copy, Debug)]
pub struct MachineRules {
    pub price: u64,
    pub floor_bps: u16,
    pub cap_bps: u32,
    pub rtp_min_bps: u16,
    pub rtp_max_bps: u16,
}

impl MachineRules {
    /// Sanity bounds on the owner's own rules.
    pub fn check(&self) -> Result<(), RuleError> {
        let ok = self.price > 0
            && self.floor_bps >= MIN_FLOOR_BPS
            && self.cap_bps <= MAX_CAP_BPS
            && self.cap_bps >= self.floor_bps as u32
            && self.rtp_min_bps >= self.floor_bps
            && self.rtp_min_bps <= self.rtp_max_bps
            && self.rtp_max_bps <= MAX_RTP_BPS;
        if ok {
            Ok(())
        } else {
            Err(RuleError::BadMachine)
        }
    }
}

/// Checks a table given as (weight, value) per outcome, value in the price's units. Returns the RTP in bps.
pub fn validate(rules: &MachineRules, outcomes: &[(u32, u64)]) -> Result<u64, RuleError> {
    if outcomes.is_empty() {
        return Err(RuleError::NoOutcomes);
    }
    let price = rules.price as u128;
    let mut total_weight: u128 = 0;
    let mut weighted: u128 = 0;
    for (i, &(weight, value)) in outcomes.iter().enumerate() {
        if weight == 0 {
            return Err(RuleError::ZeroWeight(i));
        }
        let v = value as u128;
        if v * BPS < price * rules.floor_bps as u128 {
            return Err(RuleError::BelowFloor(i));
        }
        if v * BPS > price * rules.cap_bps as u128 {
            return Err(RuleError::AboveCap(i));
        }
        total_weight += weight as u128;
        weighted += weight as u128 * v;
    }
    let rtp = (weighted * BPS / (total_weight * price)) as u64;
    if rtp < rules.rtp_min_bps as u64 || rtp > rules.rtp_max_bps as u64 {
        return Err(RuleError::RtpOutOfBand(rtp));
    }
    Ok(rtp)
}

/// A uniform number in [0, total) from a 32 byte VRF output. 128 bits mod a total under 2^40 has a bias far below
/// anything a table can express.
pub fn roll(randomness: &[u8; 32], total: u64) -> u64 {
    let mut b = [0u8; 16];
    b.copy_from_slice(&randomness[..16]);
    (u128::from_le_bytes(b) % total.max(1) as u128) as u64
}

/// Index of the outcome a roll in [0, sum(weights)) lands on.
pub fn pick(weights: impl IntoIterator<Item = u32>, roll: u64) -> usize {
    let mut acc: u64 = 0;
    let mut last = 0;
    for (i, w) in weights.into_iter().enumerate() {
        acc += w as u64;
        last = i;
        if roll < acc {
            return i;
        }
    }
    last
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The Single machine from lib/machines.json, priced in USDC 6 dp.
    fn single() -> (MachineRules, Vec<(u32, u64)>) {
        let price = 1_000_000u64;
        let tiers = [(5606u32, 5265u64), (2345, 8000), (1704, 10000), (250, 20000), (80, 40000), (15, 100000)];
        let outcomes = tiers.iter().map(|&(w, m)| (w, price * m / 10_000)).collect();
        (MachineRules { price, floor_bps: 5000, cap_bps: 100_000, rtp_min_bps: 7400, rtp_max_bps: 7600 }, outcomes)
    }

    #[test]
    fn single_table_is_valid() {
        let (r, o) = single();
        r.check().unwrap();
        let rtp = validate(&r, &o).unwrap();
        assert!((7400..=7600).contains(&rtp), "rtp {rtp}");
    }

    #[test]
    fn floor_and_cap_are_enforced() {
        let (r, mut o) = single();
        o[0].1 = 499_999;
        assert_eq!(validate(&r, &o), Err(RuleError::BelowFloor(0)));
        let (r, mut o) = single();
        o[5].1 = 10_000_001;
        assert_eq!(validate(&r, &o), Err(RuleError::AboveCap(5)));
    }

    #[test]
    fn rtp_band_is_enforced() {
        let (r, mut o) = single();
        o[5].0 = 2_000;
        assert!(matches!(validate(&r, &o), Err(RuleError::RtpOutOfBand(_))));
    }

    #[test]
    fn bad_machine_rules() {
        let (mut r, _) = single();
        r.floor_bps = 4_000;
        assert_eq!(r.check(), Err(RuleError::BadMachine));
        let (mut r, _) = single();
        r.rtp_max_bps = 9_600;
        assert_eq!(r.check(), Err(RuleError::BadMachine));
    }

    #[test]
    fn pick_walks_weights() {
        let w = [10u32, 0, 5, 1];
        assert_eq!(pick(w, 0), 0);
        assert_eq!(pick(w, 9), 0);
        assert_eq!(pick(w, 10), 2);
        assert_eq!(pick(w, 14), 2);
        assert_eq!(pick(w, 15), 3);
    }

    #[test]
    fn draw_matches_weights() {
        let (_, o) = single();
        let total: u64 = o.iter().map(|x| x.0 as u64).sum();
        let mut hits = vec![0u32; o.len()];
        let mut seed = [7u8; 32];
        for i in 0..200_000u32 {
            seed[..4].copy_from_slice(&i.to_le_bytes());
            // A cheap mix so consecutive seeds do not map to consecutive rolls.
            let mut x = u128::from_le_bytes(seed[..16].try_into().unwrap()).wrapping_mul(0x9E3779B97F4A7C15F39CC0605CEDC835);
            x ^= x >> 61;
            let mut r = seed;
            r[..16].copy_from_slice(&x.to_le_bytes());
            hits[pick(o.iter().map(|x| x.0), roll(&r, total))] += 1;
        }
        let p0 = hits[0] as f64 / 200_000.0;
        assert!((p0 - 0.5606).abs() < 0.01, "common share {p0}");
    }
}
