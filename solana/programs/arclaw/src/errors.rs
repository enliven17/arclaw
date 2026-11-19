use anchor_lang::prelude::*;

#[error_code]
pub enum ArclawError {
    #[msg("Paused")]
    Paused,
    #[msg("Unknown machine")]
    UnknownMachine,
    #[msg("Machine is off")]
    MachineOff,
    #[msg("Machine rules out of bounds")]
    BadMachine,
    #[msg("Machine price cannot change once set")]
    PriceImmutable,
    #[msg("No prizes set")]
    NoPrizes,
    #[msg("Too many outcomes")]
    TooManyOutcomes,
    #[msg("Outcome has a zero weight or an empty card")]
    BadPrize,
    #[msg("Outcome below the floor")]
    BelowFloor,
    #[msg("Outcome above the cap")]
    AboveCap,
    #[msg("Expected return out of band")]
    RtpOutOfBand,
    #[msg("Prize table is stale")]
    TableStale,
    #[msg("Zero amount")]
    ZeroAmount,
    #[msg("Too many boxes")]
    TooManyBoxes,
    #[msg("Not enough sealed boxes")]
    NoBoxes,
    #[msg("Not the operator")]
    NotOperator,
    #[msg("Not the round's driver")]
    NotDriver,
    #[msg("Round is not in the right state")]
    BadRoundState,
    #[msg("Draw has not timed out yet")]
    NotExpired,
    #[msg("Wrong oracle queue")]
    BadQueue,
    #[msg("Card accounts do not match the pack")]
    BadCardAccounts,
    #[msg("Amount is reserved for players")]
    Reserved,
    #[msg("Link expired")]
    LinkExpired,
    #[msg("Link not expired")]
    LinkLive,
    #[msg("Nothing owed")]
    NothingOwed,
    #[msg("Math overflow")]
    Overflow,
}
